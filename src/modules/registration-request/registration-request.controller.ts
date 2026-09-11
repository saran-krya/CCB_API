import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '../../common/decorators/permission.decorator';
import {
  ActionByDto,
  CreateRegistrationRequestDraftDto,
  MandatoryCommentActionDto,
  RecordDepositPaymentDto,
  RegistrationRequestQueryDto,
  RequestDepositDto,
  SetExtractedFieldsDto,
  SetExtractedFieldValueDto,
  ToggleExtractedFieldVerifiedDto,
  UpdateRegistrationRequestDraftDto,
  UploadRegistrationDocumentDto,
} from './dto/registration-request.dto';
import { RegistrationRequestService } from './registration-request.service';

@ApiBearerAuth()
@ApiTags('Registration Requests')
@Controller({ path: 'registration-requests', version: '1' })
export class RegistrationRequestController {
  constructor(private readonly requests: RegistrationRequestService) {}

  // Also VIEW_CUSTOMER: the Customer detail page's own Profile tab renders the customer's
  // originating registration request (same ApplicantDetailContent component Registration
  // Requests/Approval use — see that page's own comment) via `?customerId=` — a Customer-only
  // viewer reading the one request tied to the customer they're already viewing, not browsing the
  // Registration Requests queue as a feature. Does NOT grant approve/reject/edit — those stay on
  // their own action endpoints, untouched.
  @Get()
  @Permission('VIEW_REGISTRATION_REQUESTS', 'REGISTRATION_APPROVAL_VIEW', 'VIEW_CUSTOMER')
  @ApiOperation({ summary: 'List registration requests' })
  findAll(@Query() query: RegistrationRequestQueryDto) {
    return this.requests.findAll(query);
  }

  // Also VIEW_CUSTOMER: same reasoning as findAll above — the by-id fetch that follows resolving
  // the request id from the list call.
  @Get(':id')
  @Permission('VIEW_REGISTRATION_REQUESTS', 'REGISTRATION_APPROVAL_VIEW', 'VIEW_CUSTOMER')
  @ApiOperation({ summary: 'Get registration request detail' })
  @ApiParam({ name: 'id', type: Number })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.requests.findOne(id);
  }

  @Get(':id/deposit-preview')
  @Permission('VIEW_REGISTRATION_REQUESTS', 'REGISTRATION_APPROVAL_VIEW')
  @ApiOperation({ summary: 'Preview the per-unit deposit/activation-fee components without raising a demand' })
  @ApiParam({ name: 'id', type: Number })
  previewDeposit(@Param('id', ParseIntPipe) id: number) {
    return this.requests.previewDeposit(id);
  }

  @Get(':id/applicable-document-rules')
  @Permission('VIEW_REGISTRATION_REQUESTS', 'CREATE_REGISTRATION_REQUEST')
  @ApiOperation({ summary: 'Resolve which registration documents apply to this request\'s applicant profile' })
  @ApiParam({ name: 'id', type: Number })
  getApplicableDocumentRules(@Param('id', ParseIntPipe) id: number) {
    return this.requests.getApplicableDocumentRules(id);
  }

  @Post('draft')
  @Permission('CREATE_REGISTRATION_REQUEST')
  @ApiOperation({ summary: 'Create a Path-B (CS-initiated) registration draft' })
  createDraft(
    @Body() dto: CreateRegistrationRequestDraftDto,
    @CurrentUser() user?: AuthenticatedUser,
    @Req() req?: Request,
  ) {
    return this.requests.createDraft(dto, user?.sub, req?.ip);
  }

  @Patch(':id/draft')
  @Permission('CREATE_REGISTRATION_REQUEST')
  @ApiOperation({ summary: 'Edit a Draft registration request' })
  @ApiParam({ name: 'id', type: Number })
  updateDraft(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRegistrationRequestDraftDto,
    @CurrentUser() user?: AuthenticatedUser,
    @Req() req?: Request,
  ) {
    return this.requests.updateDraft(id, dto, user?.sub, req?.ip);
  }

  @Post(':id/send-to-resident')
  @Permission('CREATE_REGISTRATION_REQUEST')
  @ApiOperation({ summary: 'Path B: share a Draft with the resident for review' })
  @ApiParam({ name: 'id', type: Number })
  sendToResident(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ActionByDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.requests.sendToResident(id, dto, user?.sub);
  }

  @Post(':id/submit-for-review')
  @Permission('CREATE_REGISTRATION_REQUEST')
  @ApiOperation({ summary: 'Submit the applicant\'s initial submission for CS review' })
  @ApiParam({ name: 'id', type: Number })
  submitForReview(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ActionByDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.requests.submitForReview(id, dto, user?.sub);
  }

  @Post(':id/return-to-resident')
  @Permission('EDIT_REGISTRATION_REQUEST')
  @ApiOperation({ summary: 'Loop 1: CS returns the request to the resident for correction' })
  @ApiParam({ name: 'id', type: Number })
  returnToResident(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MandatoryCommentActionDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.requests.returnToResident(id, dto, user?.sub);
  }

  @Post(':id/request-deposit')
  @Permission('EDIT_REGISTRATION_REQUEST', 'REGISTRATION_APPROVAL_APPROVE')
  @ApiOperation({ summary: 'Manually re-raise the deposit demand for an already-approved request (approve() already does this automatically the moment the Customer is created)' })
  @ApiParam({ name: 'id', type: Number })
  requestDeposit(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RequestDepositDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.requests.requestDeposit(id, dto, user?.sub);
  }

  @Post(':id/record-deposit-payment')
  @Permission('EDIT_REGISTRATION_REQUEST', 'CREATE_REGISTRATION_REQUEST', 'REGISTRATION_APPROVAL_APPROVE')
  @ApiOperation({ summary: 'Record the deposit payment (and receipt) — post-approval only' })
  @ApiParam({ name: 'id', type: Number })
  recordDepositPayment(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RecordDepositPaymentDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.requests.recordDepositPayment(id, dto, user?.sub);
  }

  @Post(':id/verify-deposit')
  @Permission('EDIT_REGISTRATION_REQUEST', 'REGISTRATION_APPROVAL_APPROVE')
  @ApiOperation({ summary: 'CS Supervisor verifies the recorded deposit payment, activating the (already-approved) account' })
  @ApiParam({ name: 'id', type: Number })
  verifyDeposit(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ActionByDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.requests.verifyDeposit(id, dto, user?.sub);
  }

  @Post(':id/return-receipt')
  @Permission('EDIT_REGISTRATION_REQUEST', 'REGISTRATION_APPROVAL_APPROVE')
  @ApiOperation({ summary: 'Return an unsatisfactory payment receipt to the resident for correction' })
  @ApiParam({ name: 'id', type: Number })
  returnReceiptForCorrection(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MandatoryCommentActionDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.requests.returnReceiptForCorrection(id, dto, user?.sub);
  }

  @Post(':id/approve')
  @Permission('APPROVE_REGISTRATION_REQUEST', 'REGISTRATION_APPROVAL_APPROVE')
  @ApiOperation({ summary: 'Approve the registration request, creating the Customer record (requires APPROVE_REGISTRATION_REQUEST or REGISTRATION_APPROVAL_APPROVE)' })
  @ApiParam({ name: 'id', type: Number })
  approve(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ActionByDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.requests.approve(id, dto, user?.sub);
  }

  @Post(':id/reject')
  @Permission('REJECT_REGISTRATION_REQUEST', 'REGISTRATION_APPROVAL_REJECT')
  @ApiOperation({ summary: 'Reject the registration request (requires REJECT_REGISTRATION_REQUEST or REGISTRATION_APPROVAL_REJECT)' })
  @ApiParam({ name: 'id', type: Number })
  reject(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MandatoryCommentActionDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.requests.reject(id, dto, user?.sub);
  }

  @Post(':id/documents')
  @Permission('CREATE_REGISTRATION_REQUEST', 'EDIT_REGISTRATION_REQUEST')
  @ApiOperation({ summary: 'Upload/replace a registration document' })
  @ApiParam({ name: 'id', type: Number })
  uploadDocument(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UploadRegistrationDocumentDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.requests.uploadDocument(id, dto, user?.sub);
  }

  @Delete(':id/documents/:docType')
  @Permission('CREATE_REGISTRATION_REQUEST', 'EDIT_REGISTRATION_REQUEST')
  @ApiOperation({ summary: 'Remove a single uploaded document — the unit stays selected' })
  @ApiParam({ name: 'id', type: Number })
  @ApiParam({ name: 'docType', type: String })
  removeDocument(
    @Param('id', ParseIntPipe) id: number,
    @Param('docType') docType: string,
    @Query('unitId') unitId?: string,
  ) {
    return this.requests.removeDocument(id, docType, unitId !== undefined ? Number(unitId) : undefined);
  }

  @Patch(':id/documents/:docType/extracted-fields/:fieldName/verified')
  @Permission('CREATE_REGISTRATION_REQUEST', 'EDIT_REGISTRATION_REQUEST')
  @ApiOperation({ summary: 'Toggle an extracted field\'s verified attestation' })
  @ApiParam({ name: 'id', type: Number })
  @ApiParam({ name: 'docType', type: String })
  @ApiParam({ name: 'fieldName', type: String })
  toggleExtractedFieldVerified(
    @Param('id', ParseIntPipe) id: number,
    @Param('docType') docType: string,
    @Param('fieldName') fieldName: string,
    @Body() dto: ToggleExtractedFieldVerifiedDto,
  ) {
    return this.requests.toggleExtractedFieldVerified(id, docType, fieldName, dto);
  }

  @Put(':id/documents/:docType/extracted-fields')
  @Permission('CREATE_REGISTRATION_REQUEST', 'EDIT_REGISTRATION_REQUEST')
  @ApiOperation({ summary: 'Persist a document\'s extracted fields — OCR, simulated, or manual-entry results alike' })
  @ApiParam({ name: 'id', type: Number })
  @ApiParam({ name: 'docType', type: String })
  setExtractedFields(
    @Param('id', ParseIntPipe) id: number,
    @Param('docType') docType: string,
    @Body() dto: SetExtractedFieldsDto,
  ) {
    return this.requests.setExtractedFields(id, docType, dto);
  }

  @Patch(':id/documents/:docType/extracted-fields/verified')
  @Permission('CREATE_REGISTRATION_REQUEST', 'EDIT_REGISTRATION_REQUEST')
  @ApiOperation({ summary: 'Verify (or un-verify) every extracted field on a document in one atomic write' })
  @ApiParam({ name: 'id', type: Number })
  @ApiParam({ name: 'docType', type: String })
  setAllExtractedFieldsVerified(
    @Param('id', ParseIntPipe) id: number,
    @Param('docType') docType: string,
    @Body() dto: ToggleExtractedFieldVerifiedDto,
  ) {
    return this.requests.setAllExtractedFieldsVerified(id, docType, dto);
  }

  @Patch(':id/documents/:docType/extracted-fields/:fieldName/value')
  @Permission('CREATE_REGISTRATION_REQUEST', 'EDIT_REGISTRATION_REQUEST')
  @ApiOperation({ summary: 'Edit a single extracted field\'s value — manual data entry, or correcting a poor OCR read' })
  @ApiParam({ name: 'id', type: Number })
  @ApiParam({ name: 'docType', type: String })
  @ApiParam({ name: 'fieldName', type: String })
  setExtractedFieldValue(
    @Param('id', ParseIntPipe) id: number,
    @Param('docType') docType: string,
    @Param('fieldName') fieldName: string,
    @Body() dto: SetExtractedFieldValueDto,
  ) {
    return this.requests.setExtractedFieldValue(id, docType, fieldName, dto);
  }
}
