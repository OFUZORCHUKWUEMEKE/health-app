import {
    registerDecorator,
    ValidationArguments,
    ValidationOptions,
} from 'class-validator';

const LOCAL_DATETIME_REGEX =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/;

export function IsIsoLocalDateTime(validationOptions?: ValidationOptions) {
    return function (object: object, propertyName: string) {
        registerDecorator({
            name: 'isIsoLocalDateTime',
            target: object.constructor,
            propertyName,
            options: validationOptions,
            validator: {
                validate(value: unknown) {
                    if (typeof value !== 'string') return false;
                    if (!LOCAL_DATETIME_REGEX.test(value)) return false;
                    const tmp = new Date(`${value}Z`);
                    return !Number.isNaN(tmp.getTime());
                },
                defaultMessage(args: ValidationArguments) {
                    return `${args.property} must be an ISO 8601 local datetime without a timezone offset (e.g. "2026-04-16T10:00:00")`;
                },
            },
        });
    };
}
