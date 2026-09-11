import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { RegistrationRequest } from './registration-request.entity';

/**
 * One unit selected on a registration request. propertyId/communityId are a snapshot taken AT
 * SELECTION TIME, not a live lookup via unitId — deliberately no relation to the Unit/Property/
 * Community entities themselves, so a later master-data edit (a unit reassigned to a different
 * property, say) never silently shifts an already-submitted registration's grouping or tariff
 * basis. Replaces the old registration_requests.selected_units simple-json column.
 */
@Entity('registration_request_units')
@Unique(['request', 'unitId'])
export class RegistrationRequestUnit extends BaseEntity {
  @ManyToOne(() => RegistrationRequest, (r) => r.selectedUnitEntries, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'request_id' })
  request!: RegistrationRequest;

  @Index()
  @Column({ name: 'unit_id', type: 'int' })
  unitId!: number;

  @Column({ name: 'property_id', type: 'int' })
  propertyId!: number;

  @Column({ name: 'community_id', type: 'int' })
  communityId!: number;
}
