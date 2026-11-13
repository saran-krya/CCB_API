import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { isDuplicateKeyError } from '../../common/utils/db-error.util';
import { likeContainsPattern } from '../../common/utils/search-text.util';
import { MailService } from '../../mail/mail.service';
import { AttributeService } from '../attribute/attribute.service';
import { Attribute, AttributeScope, AttributeValueType } from '../attribute/entities/attribute.entity';
import { INVITATION_LIFETIME_HOURS, INVITATION_WEB_PATH } from '../account-invitation/account-invitation.constants';
import { UserService } from '../user/user.service';
import { DEFAULT_EMAIL_TEMPLATES, DefaultEmailTemplate, findDefaultTemplate } from './default-templates';
import { isSupersededDefaultBody } from './legacy-default-bodies';
import {
  DEFAULT_BUTTON_COLOR,
  DEFAULT_HEADER_COLOR,
  EmailBranding,
  ResolvedBranding,
  brandingFor as brandingForLocale,
  resolveBranding,
  validateBrandingInput,
} from './email-branding';
import {
  CreateEmailTemplateDto,
  EmailContentDto,
  EmailTemplateQueryDto,
  UpdateEmailSettingsDto,
  UpdateEmailTemplateDto,
} from './dto/email-template.dto';
import {
  COMPANY_NAME_ATTRIBUTE_INFO,
  COMPANY_NAME_ATTRIBUTE_KEY,
  COMPANY_NAME_ENV_KEY,
  DEFAULT_COMPANY_NAME,
  DEFAULT_EMAIL_LOCALE,
  EMAIL_BRANDING_ATTRIBUTE,
  EMAIL_BRANDING_ATTRIBUTE_INFO,
  EMAIL_LOCALES,
  EMAIL_TEMPLATE_AUDIT_ACTION,
  EMAIL_TEMPLATE_AUDIT_MODULE,
  EMAIL_TEMPLATE_MESSAGE,
  SYSTEM_TEMPLATE_KEYS,
  TEMPLATE_PLACEHOLDER_INFO,
  isRtlLocale,
} from './email-template.constants';
import { EmailTemplate } from './entities/email-template.entity';
import { EmailHtmlSanitizer } from './html-sanitizer';
import { formatExpiryTime, maskEmailAddress } from './mail-text.util';
import { RenderableTemplate, RenderedEmail, TemplateValues, findUnknownPlaceholders, renderEmail } from './template-renderer';

export interface EmailTemplateView {
  id: number;
  key: string;
  locale: string;
  name: string;
  subject: string;
  bodyHtml: string;
  bodyText: string | null;
  isActive: boolean;
  isSystem: boolean;
  /** Whether a built-in default exists for this template, so "Reset to default" is possible. */
  hasDefault: boolean;
  updatedAt: Date;
}

export interface EmailPreview extends RenderedEmail {
  locale: string;
  direction: 'ltr' | 'rtl';
}

export interface EmailTemplateMeta {
  placeholders: ReadonlyArray<{ name: string; description: string }>;
  locales: readonly string[];
  systemKeys: string[];
  /** Whether template HTML can be saved, previewed and test-sent: false until the `sanitize-html` package is installed. */
  sanitizerAvailable: boolean;
}

/** The e-mail branding as it is IN USE: every value already validated (a colour or logo that is not valid is shown as the default / none). */
export interface EmailSettingsView {
  companyName: string;
  /** Where the name comes from: a saved setting, the COMPANY_NAME environment variable, or the built-in default. */
  source: 'setting' | 'environment' | 'default';
  /** The https address of the logo, or null (the header then shows the company's initial and name). */
  logoUrl: string | null;
  headerColor: string;
  buttonColor: string;
  /** The administrator's footer sentence per language, or null (the built-in sentence is used). */
  footerTextEn: string | null;
  footerTextAr: string | null;
  /** What each colour is when nothing is saved, so a form can offer to go back to it. */
  defaults: { headerColor: string; buttonColor: string };
}

/**
 * Stores and renders the e-mail templates. Saved templates are HTML fragments with `{{placeholders}}`; the HTML is sanitised whenever it is
 * saved, previewed or test-sent (never trusted as typed), every placeholder value is HTML-escaped when a message is rendered, and a
 * missing or switched-off template falls back to the built-in default so an invitation can always be sent. Managing templates is for the
 * super administrator only (the controller). Sending a built-in or saved template does not need the sanitizer package.
 */
@Injectable()
export class EmailTemplateService implements OnModuleInit {
  private readonly logger = new Logger(EmailTemplateService.name);

  constructor(
    @InjectRepository(EmailTemplate)
    private readonly templates: Repository<EmailTemplate>,
    @InjectRepository(Attribute)
    private readonly attributeRows: Repository<Attribute>,
    private readonly attributes: AttributeService,
    private readonly audit: AuditService,
    private readonly sanitizer: EmailHtmlSanitizer,
    private readonly mail: MailService,
    private readonly users: UserService,
    private readonly config: ConfigService,
  ) {}

  /** Writes the built-in templates that are not stored yet, and moves a stored one that was never edited to the current built-in design (see
   *  refreshSupersededBody) — it never overwrites an administrator's edit, so edits survive every restart. A failure (the table is not there
   *  yet) is logged and never stops the application starting; sending still works from the built-in defaults. */
  async onModuleInit(): Promise<void> {
    try {
      await this.ensureDefaults();
    } catch (error) {
      this.logger.error(`The default e-mail templates could not be written: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async ensureDefaults(): Promise<void> {
    for (const template of DEFAULT_EMAIL_TEMPLATES) {
      const existing = await this.templates.findOne({
        where: { key: template.key, locale: template.locale },
        select: { id: true, isSystem: true, bodyHtml: true },
      });
      if (existing) {
        await this.refreshSupersededBody(existing, template);
        continue;
      }
      try {
        await this.templates.save(
          this.templates.create({
            key: template.key,
            locale: template.locale,
            name: template.name,
            subject: template.subject,
            bodyHtml: template.bodyHtml,
            bodyText: null,
            isActive: true,
            isSystem: true,
            updatedBy: null,
          }),
        );
      } catch (error) {
        // Another API instance starting at the same moment wrote this one first (the (key, locale) pair is unique): nothing to do, and the
        // rest of the built-in templates must still be checked.
        if (!isDuplicateKeyError(error)) throw error;
      }
    }
  }

  /**
   * A built-in template whose stored body is still, character for character, the one an earlier release shipped has never been edited, so it
   * moves to the current built-in design (an administrator who wants the old one back can edit it). Any other body is somebody's work and is
   * never touched. `updated_at` is kept as it was, so the screen does not claim someone edited the template just now, and the update names the
   * old body in its WHERE clause, so an edit saved at the same moment is not overwritten.
   */
  private async refreshSupersededBody(stored: Pick<EmailTemplate, 'id' | 'isSystem' | 'bodyHtml'>, builtIn: DefaultEmailTemplate): Promise<void> {
    if (!stored.isSystem || stored.bodyHtml === builtIn.bodyHtml) return;
    if (!isSupersededDefaultBody(builtIn.key, builtIn.locale, stored.bodyHtml)) return;
    await this.templates.update({ id: stored.id, bodyHtml: stored.bodyHtml }, { bodyHtml: builtIn.bodyHtml, updatedAt: () => 'updated_at' });
    this.logger.log(`The built-in e-mail template ${builtIn.key} (${builtIn.locale}) was moved to the current design; it had never been edited.`);
  }

  getMeta(): EmailTemplateMeta {
    return {
      placeholders: TEMPLATE_PLACEHOLDER_INFO,
      locales: EMAIL_LOCALES,
      systemKeys: [...SYSTEM_TEMPLATE_KEYS],
      sanitizerAvailable: this.sanitizer.isAvailable(),
    };
  }

  async list(query: EmailTemplateQueryDto): Promise<EmailTemplateView[]> {
    const qb = this.templates
      .createQueryBuilder('t')
      .orderBy('t.isSystem', 'DESC')
      .addOrderBy('t.key', 'ASC')
      .addOrderBy('t.locale', 'ASC');
    if (query.locale) qb.andWhere('t.locale = :locale', { locale: query.locale });
    if (query.key) qb.andWhere('t.key = :key', { key: query.key });
    if (query.active) qb.andWhere('t.isActive = :active', { active: query.active === 'true' });
    if (query.search) {
      // % and _ typed in the search box are literal characters, as in every other list of this project.
      qb.andWhere('(t.name LIKE :search OR t.key LIKE :search OR t.subject LIKE :search)', { search: likeContainsPattern(query.search) });
    }
    return (await qb.getMany()).map((row) => this.toView(row));
  }

  async findOne(id: number): Promise<EmailTemplateView> {
    return this.toView(await this.findEntity(id));
  }

  async create(dto: CreateEmailTemplateDto, principal: AuthenticatedUser): Promise<EmailTemplateView> {
    const taken = await this.templates.findOne({ where: { key: dto.key, locale: dto.locale }, select: { id: true } });
    if (taken) throw new ConflictException(EMAIL_TEMPLATE_MESSAGE.KEY_TAKEN);

    const content = this.prepare(dto);
    let saved: EmailTemplate;
    try {
      saved = await this.templates.save(
        this.templates.create({
          key: dto.key,
          locale: dto.locale,
          name: dto.name,
          subject: content.subject,
          bodyHtml: content.bodyHtml,
          bodyText: content.bodyText,
          isActive: dto.isActive ?? true,
          isSystem: SYSTEM_TEMPLATE_KEYS.has(dto.key),
          updatedBy: principal.sub,
        }),
      );
    } catch (error) {
      if (isDuplicateKeyError(error)) throw new ConflictException(EMAIL_TEMPLATE_MESSAGE.KEY_TAKEN);
      throw error;
    }

    await this.audit.record({
      moduleName: EMAIL_TEMPLATE_AUDIT_MODULE,
      entityId: saved.id,
      action: EMAIL_TEMPLATE_AUDIT_ACTION.CREATED,
      newValue: { key: saved.key, locale: saved.locale, name: saved.name, isActive: saved.isActive },
      performedBy: principal.sub,
    });
    return this.toView(saved);
  }

  async update(id: number, dto: UpdateEmailTemplateDto, principal: AuthenticatedUser): Promise<EmailTemplateView> {
    const template = await this.findEntity(id);
    const changed: string[] = [];

    if (dto.subject !== undefined || dto.bodyHtml !== undefined || dto.bodyText !== undefined) {
      const content = this.prepare({
        subject: dto.subject ?? template.subject,
        bodyHtml: dto.bodyHtml ?? template.bodyHtml,
        bodyText: dto.bodyText === undefined ? template.bodyText : dto.bodyText,
      });
      if (content.subject !== template.subject) changed.push('subject');
      if (content.bodyHtml !== template.bodyHtml) changed.push('bodyHtml');
      if (content.bodyText !== template.bodyText) changed.push('bodyText');
      template.subject = content.subject;
      template.bodyHtml = content.bodyHtml;
      template.bodyText = content.bodyText;
    }
    if (dto.name !== undefined && dto.name !== template.name) {
      template.name = dto.name;
      changed.push('name');
    }
    if (dto.isActive !== undefined && dto.isActive !== template.isActive) {
      template.isActive = dto.isActive;
      changed.push('isActive');
    }
    if (changed.length === 0) return this.toView(template);

    template.updatedBy = principal.sub;
    const saved = await this.templates.save(template);
    await this.audit.record({
      moduleName: EMAIL_TEMPLATE_AUDIT_MODULE,
      entityId: saved.id,
      action: EMAIL_TEMPLATE_AUDIT_ACTION.UPDATED,
      newValue: { key: saved.key, locale: saved.locale, changedFields: changed },
      performedBy: principal.sub,
    });
    return this.toView(saved);
  }

  async setActive(id: number, isActive: boolean, principal: AuthenticatedUser): Promise<EmailTemplateView> {
    const template = await this.findEntity(id);
    if (template.isActive === isActive) return this.toView(template);
    template.isActive = isActive;
    template.updatedBy = principal.sub;
    const saved = await this.templates.save(template);
    await this.audit.record({
      moduleName: EMAIL_TEMPLATE_AUDIT_MODULE,
      entityId: saved.id,
      action: isActive ? EMAIL_TEMPLATE_AUDIT_ACTION.ACTIVATED : EMAIL_TEMPLATE_AUDIT_ACTION.DEACTIVATED,
      newValue: { key: saved.key, locale: saved.locale },
      performedBy: principal.sub,
    });
    return this.toView(saved);
  }

  /** Puts a built-in template back to its shipped subject and body (and switches it on). */
  async resetToDefault(id: number, principal: AuthenticatedUser): Promise<EmailTemplateView> {
    const template = await this.findEntity(id);
    if (!template.isSystem) throw new BadRequestException(EMAIL_TEMPLATE_MESSAGE.NOT_SYSTEM);
    const builtIn = findDefaultTemplate(template.key, template.locale);
    if (!builtIn) throw new BadRequestException(EMAIL_TEMPLATE_MESSAGE.NO_DEFAULT);

    template.name = builtIn.name;
    template.subject = builtIn.subject;
    template.bodyHtml = builtIn.bodyHtml;
    template.bodyText = null;
    template.isActive = true;
    template.updatedBy = principal.sub;
    const saved = await this.templates.save(template);
    await this.audit.record({
      moduleName: EMAIL_TEMPLATE_AUDIT_MODULE,
      entityId: saved.id,
      action: EMAIL_TEMPLATE_AUDIT_ACTION.RESET,
      newValue: { key: saved.key, locale: saved.locale },
      performedBy: principal.sub,
    });
    return this.toView(saved);
  }

  /** What a message would look like, rendered exactly as it would be sent (sanitised, sample values, escaped, in the layout). */
  async preview(dto: EmailContentDto): Promise<EmailPreview> {
    const content = this.prepare(dto);
    const branding = await this.brandingForMessage(dto.locale);
    const rendered = renderEmail(content, this.sampleValues(dto.locale), { locale: dto.locale, branding });
    return { ...rendered, locale: dto.locale, direction: isRtlLocale(dto.locale) ? 'rtl' : 'ltr' };
  }

  /** Sends the rendered sample to the signed-in administrator's OWN address and nobody else's — the address is read from their account, never
   *  taken from the request. */
  async sendTest(dto: EmailContentDto, principal: AuthenticatedUser): Promise<{ sent: boolean; error?: string; to: string }> {
    const content = this.prepare(dto);
    const account = await this.users.findOne(principal.sub);
    if (!account.email) throw new BadRequestException(EMAIL_TEMPLATE_MESSAGE.NO_ADDRESS);

    const branding = await this.brandingForMessage(dto.locale);
    const rendered = renderEmail(content, this.sampleValues(dto.locale), { locale: dto.locale, branding });
    const result = await this.mail.send({
      to: account.email,
      subject: `[Test] ${rendered.subject}`,
      html: rendered.html,
      text: rendered.text,
      purpose: 'email template test',
    });

    await this.audit.record({
      moduleName: EMAIL_TEMPLATE_AUDIT_MODULE,
      entityId: principal.sub,
      action: EMAIL_TEMPLATE_AUDIT_ACTION.TEST_SENT,
      newValue: { locale: dto.locale, sent: result.sent },
      performedBy: principal.sub,
    });
    return { ...result, to: maskEmailAddress(account.email) };
  }

  /** The finished message for a template key in a language — what the invitation system sends. An active saved template is used; otherwise the
   *  built-in default (in the language, else in English). Does not sanitise: saved HTML was sanitised when it was saved. */
  async render(key: string, locale: string, values: TemplateValues): Promise<RenderedEmail> {
    const template = await this.resolve(key, locale);
    const branding = await this.brandingForMessage(template.locale);
    return renderEmail(template, values, { locale: template.locale, branding });
  }

  // ── Branding (Platform Settings values) ─────────────────────────────────────────────────────────

  async getCompanyName(): Promise<string> {
    return (await this.readBranding()).resolved.companyName;
  }

  /** The branding of one message: the settings in use, with the footer of that message's language. */
  private async brandingForMessage(locale: string): Promise<EmailBranding> {
    return brandingForLocale((await this.readBranding()).resolved, locale);
  }

  /** Reads the stored settings and resolves them: whatever is missing, empty or (if edited on the Attributes screen) invalid is replaced by the
   *  default, so a message can always be rendered. The company name falls back to the COMPANY_NAME environment variable, then the default. */
  private async readBranding(): Promise<{ resolved: ResolvedBranding; source: EmailSettingsView['source'] }> {
    const storedName = (await this.attributes.getValueByKey(COMPANY_NAME_ATTRIBUTE_KEY))?.trim();
    const fromEnvironment = this.config.get<string>(COMPANY_NAME_ENV_KEY)?.trim();
    const source: EmailSettingsView['source'] = storedName ? 'setting' : fromEnvironment ? 'environment' : 'default';

    const [logoUrl, headerColor, buttonColor, footerTextEn, footerTextAr] = await Promise.all([
      this.attributes.getValueByKey(EMAIL_BRANDING_ATTRIBUTE.LOGO_URL),
      this.attributes.getValueByKey(EMAIL_BRANDING_ATTRIBUTE.HEADER_COLOR),
      this.attributes.getValueByKey(EMAIL_BRANDING_ATTRIBUTE.BUTTON_COLOR),
      this.attributes.getValueByKey(EMAIL_BRANDING_ATTRIBUTE.FOOTER_TEXT_EN),
      this.attributes.getValueByKey(EMAIL_BRANDING_ATTRIBUTE.FOOTER_TEXT_AR),
    ]);
    const resolved = resolveBranding(
      { companyName: storedName || fromEnvironment, logoUrl, headerColor, buttonColor, footerTextEn, footerTextAr },
      { companyName: DEFAULT_COMPANY_NAME },
    );
    return { resolved, source };
  }

  async getSettings(): Promise<EmailSettingsView> {
    const { resolved, source } = await this.readBranding();
    return {
      companyName: resolved.companyName,
      source,
      logoUrl: resolved.logoUrl,
      headerColor: resolved.headerColor,
      buttonColor: resolved.buttonColor,
      footerTextEn: resolved.footerTextEn,
      footerTextAr: resolved.footerTextAr,
      defaults: { headerColor: DEFAULT_HEADER_COLOR, buttonColor: DEFAULT_BUTTON_COLOR },
    };
  }

  /**
   * Saves the branding as SYSTEM attributes. A row is created the first time its value is set (no seed, nothing written before an
   * administrator does this); afterwards it is edited through AttributeService.update, which clears the cache and writes its own audit row.
   * A setting that is left out is unchanged; an empty or null one is cleared (back to the default). The format rules are checked first, as one
   * 400 with a message per field, and nothing is saved if any fails.
   */
  async updateSettings(dto: UpdateEmailSettingsDto, principal: AuthenticatedUser): Promise<EmailSettingsView> {
    const problems = validateBrandingInput(dto);
    if (Object.keys(problems).length > 0) throw new BadRequestException(Object.values(problems));

    const before = await this.getSettings();
    const changed: string[] = [];
    const save = async (field: string, key: string, info: { label: string; description: string; displayOrder: number }, value: string | null | undefined, unchangedValue?: string) => {
      if (await this.saveTextSetting(key, info, value, principal, unchangedValue)) changed.push(field);
    };

    await save('companyName', COMPANY_NAME_ATTRIBUTE_KEY, COMPANY_NAME_ATTRIBUTE_INFO, dto.companyName);
    await save('logoUrl', EMAIL_BRANDING_ATTRIBUTE.LOGO_URL, EMAIL_BRANDING_ATTRIBUTE_INFO.EMAIL_LOGO_URL, dto.logoUrl);
    // Colours are stored in capitals. A null means "clear" and must stay null (not become "unchanged"), so it is not passed through `?.`.
    const upper = (value: string | null | undefined): string | null | undefined => (typeof value === 'string' ? value.toUpperCase() : value);
    await save('headerColor', EMAIL_BRANDING_ATTRIBUTE.HEADER_COLOR, EMAIL_BRANDING_ATTRIBUTE_INFO.EMAIL_HEADER_COLOR, upper(dto.headerColor), DEFAULT_HEADER_COLOR);
    await save('buttonColor', EMAIL_BRANDING_ATTRIBUTE.BUTTON_COLOR, EMAIL_BRANDING_ATTRIBUTE_INFO.EMAIL_BUTTON_COLOR, upper(dto.buttonColor), DEFAULT_BUTTON_COLOR);
    await save('footerTextEn', EMAIL_BRANDING_ATTRIBUTE.FOOTER_TEXT_EN, EMAIL_BRANDING_ATTRIBUTE_INFO.EMAIL_FOOTER_TEXT_EN, dto.footerTextEn);
    await save('footerTextAr', EMAIL_BRANDING_ATTRIBUTE.FOOTER_TEXT_AR, EMAIL_BRANDING_ATTRIBUTE_INFO.EMAIL_FOOTER_TEXT_AR, dto.footerTextAr);

    const after = await this.getSettings();
    if (changed.length > 0) {
      // The footer texts are left out of the audit row (they can be long); which fields changed is recorded either way.
      const summary = (view: EmailSettingsView) => ({ companyName: view.companyName, logoUrl: view.logoUrl, headerColor: view.headerColor, buttonColor: view.buttonColor });
      await this.audit.record({
        moduleName: EMAIL_TEMPLATE_AUDIT_MODULE,
        entityId: 0,
        action: EMAIL_TEMPLATE_AUDIT_ACTION.SETTINGS_CHANGED,
        oldValue: summary(before),
        newValue: { ...summary(after), changedFields: changed },
        performedBy: principal.sub,
      });
    }
    return after;
  }

  /**
   * Stores one text setting and says whether anything changed. `undefined` leaves it alone. With no row yet, an empty value (or one equal to
   * `unchangedValue`, the default) writes nothing; with a row, an empty value clears it.
   */
  private async saveTextSetting(
    key: string,
    info: { label: string; description: string; displayOrder: number },
    value: string | null | undefined,
    principal: AuthenticatedUser,
    unchangedValue?: string,
  ): Promise<boolean> {
    if (value === undefined) return false;
    const next = (value ?? '').trim();
    const [existing] = await this.attributes.findByKeys([key]);

    if (!existing) {
      if (next === '' || next === unchangedValue) return false;
      const created = await this.attributeRows.save(
        this.attributeRows.create({
          scope: AttributeScope.SYSTEM,
          module: null,
          groupKey: null,
          groupLabel: null,
          groupDescription: null,
          key,
          label: info.label,
          description: info.description,
          valueType: AttributeValueType.TEXT,
          value: next,
          customerValue: null,
          trueLabel: null,
          falseLabel: null,
          unit: null,
          editable: true,
          isSystemDefined: false,
          displayOrder: info.displayOrder,
        }),
      );
      await this.audit.record({
        moduleName: 'attributes',
        entityId: created.id,
        action: 'CREATE',
        newValue: { key: created.key, value: created.value },
        performedBy: principal.sub,
      });
      return true;
    }

    if ((existing.value ?? '') === next) return false;
    await this.attributes.update(existing.id, { value: next }, principal.sub, principal.roleNames, principal.roleIds);
    return true;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────────────────────────

  private async findEntity(id: number): Promise<EmailTemplate> {
    const template = await this.templates.findOne({ where: { id } });
    if (!template) throw new NotFoundException(EMAIL_TEMPLATE_MESSAGE.NOT_FOUND);
    return template;
  }

  /** The template to send for `key` in `locale`. */
  private async resolve(key: string, locale: string): Promise<RenderableTemplate & { locale: string }> {
    const stored = await this.templates.findOne({ where: { key, locale, isActive: true } });
    if (stored) return { subject: stored.subject, bodyHtml: stored.bodyHtml, bodyText: stored.bodyText, locale: stored.locale };

    const builtIn = findDefaultTemplate(key, locale) ?? findDefaultTemplate(key, DEFAULT_EMAIL_LOCALE);
    if (!builtIn) throw new NotFoundException(EMAIL_TEMPLATE_MESSAGE.NO_DEFAULT);
    return { subject: builtIn.subject, bodyHtml: builtIn.bodyHtml, bodyText: null, locale: builtIn.locale };
  }

  /** Cleans the HTML (503 when the sanitizer package is missing), then refuses unknown placeholders in the subject, the cleaned HTML or the text. */
  private prepare(content: { subject: string; bodyHtml: string; bodyText?: string | null }): {
    subject: string;
    bodyHtml: string;
    bodyText: string | null;
  } {
    const bodyHtml = this.sanitizer.sanitize(content.bodyHtml);
    if (bodyHtml.length === 0) throw new BadRequestException(EMAIL_TEMPLATE_MESSAGE.EMPTY_BODY);
    const bodyText = content.bodyText && content.bodyText.trim().length > 0 ? content.bodyText : null;

    const unknown = findUnknownPlaceholders(content.subject, bodyHtml, bodyText);
    if (unknown.length > 0) throw new BadRequestException(EMAIL_TEMPLATE_MESSAGE.UNKNOWN_PLACEHOLDERS(unknown));
    return { subject: content.subject, bodyHtml, bodyText };
  }

  /** Example values for a preview or a test send. The link is a sample that does not work; nothing real is issued. */
  private sampleValues(locale: string): Record<string, string> {
    const arabic = locale === 'ar';
    const base = this.sampleBaseUrl();
    return {
      firstName: arabic ? 'سارة' : 'Sara',
      lastName: arabic ? 'أحمد' : 'Ahmed',
      email: 'sara.ahmed@example.com',
      invitedBy: arabic ? 'مدير النظام' : 'System Administrator',
      invitationLink: `${base}${INVITATION_WEB_PATH.ACCEPT}?token=SAMPLE-LINK-THAT-DOES-NOT-WORK`,
      expiryTime: formatExpiryTime(new Date(Date.now() + INVITATION_LIFETIME_HOURS * 60 * 60 * 1000), INVITATION_LIFETIME_HOURS, locale),
      signInLink: `${base}${INVITATION_WEB_PATH.SIGN_IN}`,
      // The company name and the button colour are the branding's, supplied by the renderer.
      customerReference: 'CUST-000123',
      depositAmount: 'AED 1,000.00',
    };
  }

  private sampleBaseUrl(): string {
    const configured = this.config.get<string>('STAFF_PORTAL_URL')?.trim() || this.config.get<string>('CUSTOMER_PORTAL_URL')?.trim();
    return (configured || 'https://example.com').replace(/\/+$/, '');
  }

  private toView(template: EmailTemplate): EmailTemplateView {
    return {
      id: template.id,
      key: template.key,
      locale: template.locale,
      name: template.name,
      subject: template.subject,
      bodyHtml: template.bodyHtml,
      bodyText: template.bodyText,
      isActive: template.isActive,
      isSystem: template.isSystem,
      hasDefault: findDefaultTemplate(template.key, template.locale) !== undefined,
      updatedAt: template.updatedAt,
    };
  }
}
