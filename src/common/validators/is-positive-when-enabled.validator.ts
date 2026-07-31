import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

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
