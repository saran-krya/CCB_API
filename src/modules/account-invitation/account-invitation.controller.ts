import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { ACTION_CODES } from '../../common/constants/action-codes.constants';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '../../common/decorators/permission.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { strictRateLimit } from '../../common/security/throttle-settings';
import { AccountInvitationService } from './account-invitation.service';
import { AcceptInvitationDto, InvitationQueryDto, InviteStaffDto, ValidateInvitationDto } from './dto/account-invitation.dto';

/** Per-IP limit of the routes that create or send an invitation (on top of the global limit and the per-account / per-invitation limits). */
const ISSUE_LIMIT = { default: { limit: 30, ttl: 60_000 } };

/**
 * Account invitations — staff and customers through one mechanism.
 *
 * The two PUBLIC routes (`validate`, `accept`) are what the person opens from the e-mailed link; they take only a token and, to accept, a
 * password, and answer every refusal the same way. Everything else is for signed-in staff, and each route names what it needs — the finer
 * rule is applied by the service, because it depends on whose invitation it is: EDIT_CUSTOMER for a customer's; for an EXISTING staff account
 * EDIT_USER **and** RESET_USER_PASSWORD (sending the link is a password reset in all but name — whoever holds the mailbox chooses the
 * password), plus the super-administrator rule and the assignment boundary; a NEW staff account needs only CREATE_USER, like Create User.
 */
@ApiBearerAuth()
@ApiTags('Account Invitations')
@Controller({ path: 'account-invitations', version: '1' })
export class AccountInvitationController {
  constructor(private readonly invitations: AccountInvitationService) {}

  // ── Public (the e-mailed link) ──────────────────────────────────────────────────────────────

  @Public()
  @Throttle(strictRateLimit())
  @HttpCode(HttpStatus.OK)
  @Post('validate')
  @ApiOperation({ summary: 'Checks an invitation link and returns the first name and masked address behind it. Any problem is the same generic 400.' })
  validate(@Body() dto: ValidateInvitationDto) {
    return this.invitations.validate(dto);
  }

  @Public()
  @Throttle(strictRateLimit())
  @HttpCode(HttpStatus.OK)
  @Post('accept')
  @ApiOperation({ summary: "Accepts an invitation: the person's own password is stored and the account becomes usable. Single-use." })
  accept(@Body() dto: AcceptInvitationDto) {
    return this.invitations.accept(dto);
  }

  // ── Administrators ──────────────────────────────────────────────────────────────────────────

  // The fixed paths are declared above ":id" so they are never read as an invitation id.

  @Get('capability')
  @Permission(ACTION_CODES.CREATE_USER, ACTION_CODES.EDIT_USER, ACTION_CODES.VIEW_USER, ACTION_CODES.EDIT_CUSTOMER, ACTION_CODES.VIEW_CUSTOMER)
  @ApiOperation({ summary: 'Whether invitations are available on this server and whether it can send e-mail. Holds no secrets.' })
  capability() {
    return this.invitations.capability();
  }

  @Get()
  @Permission(ACTION_CODES.VIEW_USER, ACTION_CODES.VIEW_CUSTOMER)
  @ApiOperation({ summary: 'Invitations, filtered by account type and status. Staff ones need VIEW_USER, customer ones VIEW_CUSTOMER.' })
  list(@Query() query: InvitationQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.invitations.list(query, user);
  }

  @Post('staff')
  @Throttle(ISSUE_LIMIT)
  @Permission(ACTION_CODES.CREATE_USER)
  @ApiOperation({ summary: 'Creates a staff account WITHOUT a password and e-mails its owner an invitation to set one.' })
  inviteStaff(@Body() dto: InviteStaffDto, @CurrentUser() user: AuthenticatedUser) {
    return this.invitations.inviteStaff(dto, user);
  }

  @Post('staff/:userId/send')
  @Throttle(ISSUE_LIMIT)
  @Permission(ACTION_CODES.EDIT_USER)
  @ApiParam({ name: 'userId', type: Number })
  @ApiOperation({
    summary: 'Sends (or re-sends) an invitation to an existing staff account that is still waiting to be set up. Needs EDIT_USER and RESET_USER_PASSWORD.',
  })
  inviteExistingStaff(@Param('userId', ParseIntPipe) userId: number, @CurrentUser() user: AuthenticatedUser) {
    return this.invitations.inviteExistingStaff(userId, user);
  }

  @Post(':id/resend')
  @Throttle(ISSUE_LIMIT)
  @Permission(ACTION_CODES.EDIT_USER, ACTION_CODES.EDIT_CUSTOMER)
  @ApiParam({ name: 'id', type: Number })
  @ApiOperation({ summary: 'Re-sends an invitation. The earlier link stops working; the new one is valid for another 24 hours.' })
  resend(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.invitations.resend(id, user);
  }

  @Post(':id/cancel')
  @Permission(ACTION_CODES.EDIT_USER, ACTION_CODES.EDIT_CUSTOMER)
  @ApiParam({ name: 'id', type: Number })
  @ApiOperation({ summary: 'Cancels a pending (or expired) invitation. Its link stops working at once.' })
  cancel(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.invitations.cancel(id, user);
  }
}
