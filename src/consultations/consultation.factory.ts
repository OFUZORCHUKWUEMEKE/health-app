import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { CreateConsultationDto } from "./dto/create-consultation.dto";
import { ConsultationTypeEnum } from "./consultations.enums";
import { InvestigationDto } from "./dto/create-investigation.dto";




@Injectable()
export class ConsultationFactory {
    createNew(data: CreateConsultationDto, user_id): Record<string, any> {
        const consultation: Record<string, any> = {};

        for (const [key, value] of Object.entries(data)) {
            consultation[key] = value
        }
        let consultation_id = this.createConsultationString(data.type)
        consultation.session_number = 1
        consultation.user_id = user_id
        consultation.consultation_id = consultation_id
        return consultation;

    }

    createInvestigation(data: InvestigationDto): Record<string, any> {
        const investigation: Record<string, any> = {}
        for (const [key, value] of Object.entries(data)) {
            investigation[key] = value
        }
        return investigation
    }

    createConsultationString(type: ConsultationTypeEnum): string {
        // Generate a random string of 10 characters
        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let randomString = '';

        for (let i = 0; i < 10; i++) {
            const randomIndex = Math.floor(Math.random() * characters.length);
            randomString += characters.charAt(randomIndex);
        }

        // Create the final string format
        return `${type}-${randomString}`;
    }


}