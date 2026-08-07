import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
    registerDecorator,
    ValidationOptions,
    ValidationArguments,
} from 'class-validator';

const UTC_ISO_REGEX =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function isUtcIsoString(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    if (!UTC_ISO_REGEX.test(value)) return false;
    const parsed = new Date(value);
    return !Number.isNaN(parsed.getTime());
}

function IsUtcDateStringValidator(validationOptions?: ValidationOptions) {
    return function (object: object, propertyName: string) {
        registerDecorator({
            name: 'isUtcDateString',
            target: object.constructor,
            propertyName,
            options: validationOptions,
            validator: {
                validate(value: unknown) {
                    return isUtcIsoString(value);
                },
                defaultMessage(args: ValidationArguments) {
                    return `${args.property} must be an ISO 8601 datetime with an explicit UTC indicator (e.g. "2026-03-20T09:00:00.000Z" or "2026-03-20T10:00:00+01:00")`;
                },
            },
        });
    };
}

export function IsUtcDateString(validationOptions?: ValidationOptions) {
    return applyDecorators(
        IsUtcDateStringValidator(validationOptions),
        Transform(({ value }) => {
            if (!isUtcIsoString(value)) return value;
            return new Date(value).toISOString();
        }),
    );
}
