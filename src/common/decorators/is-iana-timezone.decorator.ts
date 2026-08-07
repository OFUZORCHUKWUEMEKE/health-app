import {
    registerDecorator,
    ValidationArguments,
    ValidationOptions,
} from 'class-validator';
import { isValidIanaTimezone } from '../utils/timezone.util';

export function IsIanaTimezone(validationOptions?: ValidationOptions) {
    return function (object: object, propertyName: string) {
        registerDecorator({
            name: 'isIanaTimezone',
            target: object.constructor,
            propertyName,
            options: validationOptions,
            validator: {
                validate(value: unknown) {
                    return typeof value === 'string' && isValidIanaTimezone(value);
                },
                defaultMessage(args: ValidationArguments) {
                    return `${args.property} must be a valid IANA timezone (e.g. "Africa/Lagos", "America/Edmonton")`;
                },
            },
        });
    };
}
