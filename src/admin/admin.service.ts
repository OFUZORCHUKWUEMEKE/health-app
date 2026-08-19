import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { CreateDoctorDto } from 'src/doctors/dto/create-doctor';
import { DoctorRepository } from 'src/doctors/doctors.repository';
import { GenerateRandomString } from 'src/utils/code-generator.util';
import {
	ConsultationDocument,
	InvestigationDocument,
	MedicationDocument,
} from 'src/consultations/consultations.model';
import { AppointmentDocument } from 'src/bookings/models/appointment.model';
import { MrnService } from 'src/common/mrn/mrn.service';
import { MrnOwnerType } from 'src/common/enums';

@Injectable()
export class AdminService {
	constructor(
		private readonly doctorRepository: DoctorRepository,
		@InjectModel('Consultation')
		private readonly consultationModel: Model<ConsultationDocument>,
		@InjectModel('Medication')
		private readonly medicationModel: Model<MedicationDocument>,
		@InjectModel('Investigation')
		private readonly investigationModel: Model<InvestigationDocument>,
		@InjectModel('Appointment')
		private readonly appointmentModel: Model<AppointmentDocument>,
		private readonly mrnService: MrnService,
	) { }

	async createDoctor(dto: CreateDoctorDto) {
		const email = dto.email.toLowerCase();

		const existingDoctor = await this.doctorRepository.findOne({ email });
		if (existingDoctor) {
			throw new ConflictException('Doctor already exists');
		}

		const passwordHash = await bcrypt.hash(dto.password, 10);
		const doctorNo = `DOC-${Date.now().toString(36).toUpperCase()}-${GenerateRandomString(4).toUpperCase()}`;
		const mrn = await this.mrnService.generateUniqueMrn(MrnOwnerType.DOCTOR);

		// dto is a validated DTO instance with no `mrn` property, so this spread cannot
		// override the server-generated value below.
		const doctor = await this.doctorRepository.create({
			...dto,
			email,
			password_hash: passwordHash,
			doctor_no: doctorNo,
			mrn,
			full_name: `${dto.first_name} ${dto.last_name}`,
		});
		await this.mrnService.claim(mrn, String(doctor._id));

		return doctor.toJSON();
	}

	async getAllDoctors(page = 1, limit = 20) {
		const skip = (page - 1) * limit;
		const [doctors, total] = await Promise.all([
			this.doctorRepository
				.model()
				.find()
				.sort({ createdAt: -1 })
				.skip(skip)
				.limit(limit),
			this.doctorRepository.model().countDocuments(),
		]);

		return {
			doctors,
			pagination: {
				total,
				page,
				limit,
				total_pages: Math.ceil(total / limit),
			},
		};
	}

	async getSystemMetrics() {
		const now = new Date();
		const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
		const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

		const models = [
			{ key: 'consultations', model: this.consultationModel },
			{ key: 'medications', model: this.medicationModel },
			{ key: 'investigations', model: this.investigationModel },
			{ key: 'appointments', model: this.appointmentModel },
		] as const;

		const counts = await Promise.all(
			models.flatMap(({ model }) => [
				model.countDocuments(),
				model.countDocuments({ createdAt: { $gte: startOfMonth } }),
				model.countDocuments({ createdAt: { $gte: startOfLastMonth, $lt: startOfMonth } }),
			]),
		);

		const result: Record<string, any> = {};
		models.forEach(({ key }, i) => {
			const total = counts[i * 3];
			const current = counts[i * 3 + 1];
			const previous = counts[i * 3 + 2];
			result[key] = this.buildMetricWithChange(total, current, previous);
		});

		return result;
	}

	private buildMetricWithChange(total: number, current: number, previous: number) {
		let change_percent = 0;
		if (previous > 0) {
			change_percent = Math.round(((current - previous) / previous) * 10000) / 100;
		} else if (current > 0) {
			change_percent = 100;
		}

		const trend: 'up' | 'down' | 'stable' =
			change_percent > 0 ? 'up' : change_percent < 0 ? 'down' : 'stable';

		return { total, current, previous, change_percent, trend };
	}
}
