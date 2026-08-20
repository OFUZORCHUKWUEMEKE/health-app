import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
    AppEvents,
    ConsultationCompletedEvent,
    ConsultationInvestigationResultsUploadedEvent,
    ConsultationInvestigationsRequestedEvent,
    ConsultationMedicationsAssignedEvent,
    ConsultationReferralAssignedEvent,
    VideoRoomOpenedEvent,
} from 'src/common/events';
import { DoctorRepository } from 'src/doctors/doctors.repository';
import { UserRepository } from 'src/users/user.repository';
import * as T from '../notification-templates';
import { NotificationsService } from '../notifications.service';

/**
 * Consultation, clinical and video events.
 *
 * Every event reaching this class has ALREADY passed its `assign_to_patient` gate at the
 * emit site — that flag is the doctor's own control over what the patient sees, so this
 * listener must never re-derive or override it.
 *
 * Copy carries counts and names only. Drug names, test names, specialists and referral
 * details stay behind the deep link. See the PHI rule in notification-templates.ts.
 */
@Injectable()
export class ClinicalNotificationsListener {
    private readonly logger = new Logger(ClinicalNotificationsListener.name);

    private static readonly NAME_FIELDS = {
        first_name: 1,
        last_name: 1,
        full_name: 1,
        timezone: 1,
    };

    constructor(
        private readonly notificationsService: NotificationsService,
        private readonly userRepository: UserRepository,
        private readonly doctorRepository: DoctorRepository,
    ) { }

    @OnEvent(AppEvents.CONSULTATION_COMPLETED)
    async onConsultationCompleted(event: ConsultationCompletedEvent) {
        const doctor = await this.loadDoctor(event.doctor_id);

        await this.dispatch(
            T.consultationSummaryAvailable({
                patient_id: event.patient_id,
                consultation_id: event.consultation_id,
                appointment_id: event.appointment_id,
                doctor,
                doctor_id: event.doctor_id,
                data: { consultation_id: event.consultation_id },
            }),
            AppEvents.CONSULTATION_COMPLETED,
        );
    }

    @OnEvent(AppEvents.CONSULTATION_INVESTIGATIONS_REQUESTED)
    async onInvestigationsRequested(event: ConsultationInvestigationsRequestedEvent) {
        const doctor = await this.loadDoctor(event.doctor_id);

        await this.dispatch(
            T.investigationsRequested({
                patient_id: event.patient_id,
                consultation_id: event.consultation_id,
                doctor,
                doctor_id: event.doctor_id,
                count: event.count,
                data: {
                    count: event.count,
                    investigation_list_ids: event.investigation_list_ids,
                },
            }),
            AppEvents.CONSULTATION_INVESTIGATIONS_REQUESTED,
        );
    }

    @OnEvent(AppEvents.CONSULTATION_MEDICATIONS_ASSIGNED)
    async onMedicationsAssigned(event: ConsultationMedicationsAssignedEvent) {
        const doctor = await this.loadDoctor(event.doctor_id);

        await this.dispatch(
            T.prescriptionReady({
                patient_id: event.patient_id,
                consultation_id: event.consultation_id,
                doctor,
                doctor_id: event.doctor_id,
                count: event.count,
                data: { count: event.count, medication_ids: event.medication_ids },
            }),
            AppEvents.CONSULTATION_MEDICATIONS_ASSIGNED,
        );
    }

    @OnEvent(AppEvents.CONSULTATION_REFERRAL_ASSIGNED)
    async onReferralAssigned(event: ConsultationReferralAssignedEvent) {
        const doctor = await this.loadDoctor(event.doctor_id);

        await this.dispatch(
            T.referralAvailable({
                patient_id: event.patient_id,
                consultation_id: event.consultation_id,
                referral_id: event.referral_id,
                doctor,
                doctor_id: event.doctor_id,
                data: { referral_id: event.referral_id },
            }),
            AppEvents.CONSULTATION_REFERRAL_ASSIGNED,
        );
    }

    /** The one patient -> doctor direction. */
    @OnEvent(AppEvents.CONSULTATION_INVESTIGATION_RESULTS_UPLOADED)
    async onResultsUploaded(event: ConsultationInvestigationResultsUploadedEvent) {
        const patient = await this.loadPatient(event.patient_id);

        await this.dispatch(
            T.investigationResultsUploaded({
                doctor_id: event.doctor_id,
                patient_id: event.patient_id,
                patient,
                consultation_id: event.consultation_id,
                investigation_list_id: event.investigation_list_id,
                image_count: event.image_count,
                data: {
                    image_count: event.image_count,
                    investigation_list_id: event.investigation_list_id,
                },
            }),
            AppEvents.CONSULTATION_INVESTIGATION_RESULTS_UPLOADED,
        );
    }

    @OnEvent(AppEvents.VIDEO_ROOM_OPENED)
    async onVideoRoomOpened(event: VideoRoomOpenedEvent) {
        const doctor = await this.loadDoctor(event.doctor_id);

        await this.dispatch(
            T.videoRoomOpened({
                patient_id: event.patient_id,
                appointment_id: event.appointment_id,
                consultation_id: event.consultation_id,
                doctor,
                doctor_id: event.doctor_id,
                data: { appointment_id: event.appointment_id },
            }),
            AppEvents.VIDEO_ROOM_OPENED,
        );
    }

    // ─── helpers ────────────────────────────────────────

    /**
     * Uses `.model()` rather than CoreRepository.findOne, which forces `{ __v: 0, ... }` —
     * mixing that exclusion with an inclusion projection makes MongoDB throw.
     */
    private async loadDoctor(id: string) {
        if (!id) return null;
        return this.doctorRepository
            .model()
            .findOne({ _id: id }, ClinicalNotificationsListener.NAME_FIELDS)
            .lean()
            .catch((e) => this.lookupFailed('doctor', id, e));
    }

    private async loadPatient(id: string) {
        if (!id) return null;
        return this.userRepository
            .model()
            .findOne({ _id: id }, ClinicalNotificationsListener.NAME_FIELDS)
            .lean()
            .catch((e) => this.lookupFailed('patient', id, e));
    }

    private lookupFailed(kind: string, id: string, error: any): null {
        this.logger.warn(
            `Could not load ${kind} ${id} for notification copy: ${error?.message ?? error}. ` +
            `Falling back to a generic name.`,
        );
        return null;
    }

    private async dispatch(spec: any, eventName: string) {
        try {
            await this.notificationsService.createMany([spec]);
        } catch (error: any) {
            this.logger.warn(
                `Failed to dispatch notification for ${eventName}: ${error?.message ?? error}`,
            );
        }
    }
}
