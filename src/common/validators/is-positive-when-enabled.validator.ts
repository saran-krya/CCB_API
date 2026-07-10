import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

// Adds "and must be greater than zero" on top of whatever unconditional
// range check already applies (e.g. @Min(0)), but only once a sibling
// boolean flag is true — e.g. a rental fee only needs to actually be a
// real charge once rental billing is switched on. Deliberately does NOT
// duplicate the base numeric/range validation itself; this only tightens
// it conditionally, so the field's other decorators keep running
// unconditionally regardless of the flag (see IsAmountOrPercentage's
// comment for why bolting a second @ValidateIf onto the same property
// would silently disable them instead).
export function IsPositiveWhenEnabled(enabledField: string, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isPositiveWhenEnabled',
      target: object.constructor,
      propertyName,
      constraints: [enabledField],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          const [enabledFieldName] = args.constraints;
          const isEnabled = (args.object as Record<string, unknown>)[enabledFieldName] === true;
          if (!isEnabled) return true;
          return typeof value === 'number' && !Number.isNaN(value) && value > 0;
        },
        defaultMessage(args: ValidationArguments) {
          const [enabledFieldName] = args.constraints;
          return `${args.property} must be greater than zero while ${enabledFieldName} is enabled`;
        },
      },
    });
  };
}
