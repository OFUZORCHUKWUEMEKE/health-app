import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Extract the authenticated user from the request.
 * Works regardless of role — the RolesGuard attaches `req.user` uniformly.
 *
 * Usage:
 *   @Get('me')
 *   getProfile(@CurrentUser() user: User) { ... }
 *
 *   @Get('me')
 *   getEmail(@CurrentUser('email') email: string) { ... }
 */
export const CurrentUser = createParamDecorator(
    (data: string | undefined, ctx: ExecutionContext) => {
        const request = ctx.switchToHttp().getRequest();
        const user = request.user;

        if (!user) return null;
        return data ? user?.[data] : user;
    },
);
