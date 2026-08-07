import { BadRequestException, Body, Controller, HttpStatus, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import { ApiExcludeEndpoint, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CoreController } from 'src/common/core/controller.core';
import { SendTestMailDto } from './dto/send-test-mail.dto';
import { MailService } from './mail.service';

@ApiTags('Mail')
@Controller('mail')
export class MailController extends CoreController {
    constructor(private readonly mailService: MailService) {
        super();
    }

    @Post('test')
    @ApiExcludeEndpoint()
    @ApiOperation({ summary: 'Send a test email (Admin only)' })
    @ApiResponse({ status: 200, description: 'Test email sent successfully' })
    async sendTestMail(
        @Body() dto: SendTestMailDto,
        @Res({ passthrough: true }) res: Response,
    ) {
        const recipient = dto.to;
        const name = dto.name || 'there';

        if (!recipient) {
            throw new BadRequestException('Recipient email is required');
        }

        await this.mailService.sendTestEmail(recipient, name);

        return this.responseSuccess(
            res,
            '00',
            'Success',
            { message: `Test email sent to ${recipient}` },
            HttpStatus.OK,
        );
    }
}
