import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

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
