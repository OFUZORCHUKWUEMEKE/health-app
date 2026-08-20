import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { NotificationCategory, NotificationType } from 'src/common/enums';

/**
 * NOTE: `forbidNonWhitelisted: true` is global (src/main.ts), so an unrecognised query
 * param is a hard 400, not a silent ignore. `?limit=20` will fail — the param is `perPage`.
 */
export class ListNotificationsQueryDto {
    @ApiPropertyOptional({ default: 1, minimum: 1, example: 1 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number = 1;

    @ApiPropertyOptional({
        default: 20,
        minimum: 1,
        maximum: 100,
        example: 20,
        description:
            'Must be 1-100. Values outside that range are REJECTED with a 400, not ' +
            'silently clamped, so a client asking for 5000 rows learns it rather than ' +
            'quietly receiving 100. (NotificationsService clamps as well, which covers ' +
            'direct service calls that bypass this DTO.)',
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    perPage?: number = 20;

    @ApiPropertyOptional({
        enum: ['read', 'unread', 'all'],
        default: 'all',
        description: 'Filter by read state.',
    })
    @IsOptional()
    @IsIn(['read', 'unread', 'all'])
    status?: 'read' | 'unread' | 'all' = 'all';

    @ApiPropertyOptional({
        enum: NotificationCategory,
        description: 'Broad grouping, suitable for feed tabs.',
    })
    @IsOptional()
    @IsEnum(NotificationCategory)
    category?: NotificationCategory;

    @ApiPropertyOptional({
        enum: NotificationType,
        description:
            'The specific event. Clients map this to an icon and a deep link — the API ' +
            'never returns an icon itself.',
    })
    @IsOptional()
    @IsEnum(NotificationType)
    type?: NotificationType;
}
