import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

// For a value whose valid range depends on a sibling "type" field being one
// of two shapes — a flat amount (bounded by whatever the business considers
// a sane ceiling for that field) or a percentage (always 0–100). Exists
// because class-validator's @ValidateIf gates EVERY decorator on the same
// property, not just the ones after it — so the previous approach here
// (`@Min(0) @ValidateIf(isPercentage) @Max(100)`) silently skipped @Min(0)
// too whenever the type was "amount", leaving that branch completely
// unvalidated. This runs unconditionally and switches its own upper bound
// internally instead, so there is exactly one way the value gets checked
// regardless of which branch is active.
export function IsAmountOrPercentage(
  typeField: string,
  percentageMarker: unknown,
  amountMax: number,
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isAmountOrPercentage',
      target: object.constructor,
      propertyName,
      constraints: [typeField, percentageMarker, amountMax],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          if (typeof value !== 'number' || Number.isNaN(value) || value < 0) return false;
          const [typeFieldName, marker, max] = args.constraints;
          const isPercentage = (args.object as Record<string, unknown>)[typeFieldName] === marker;
          return value <= (isPercentage ? 100 : max);
        },
        defaultMessage(args: ValidationArguments) {
          const [typeFieldName, marker, max] = args.constraints;
          const isPercentage = (args.object as Record<string, unknown>)[typeFieldName] === marker;
          return isPercentage
            ? `${args.property} must be a percentage between 0 and 100`
            : `${args.property} must be a non-negative amount no greater than ${max}`;
        },
      },
    });
  };
}
