

export class ConsultationCreatedEvent {
  constructor(
    public readonly consultationId: string,
    public readonly patientId: string,
  ) {}
}