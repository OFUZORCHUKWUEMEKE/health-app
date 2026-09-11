package auth

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/wizzyszn/Telemex/db/gen"
)

// JSON views preserve the Nest toJSON shapes the frontend parses: `_id`
// (not `id`), snake_case names, and no hashes. Doctors never expose mrn
// (was delete ret.mrn).

func str(v pgtype.Text) string {
	if v.Valid {
		return v.String
	}
	return ""
}

func strPtr(v pgtype.Text) *string {
	if v.Valid {
		s := v.String
		return &s
	}
	return nil
}

func patientJSON(u gen.Patient) map[string]any {
	return map[string]any{
		"_id": u.ID.String(), "registration_no": u.RegistrationNo,
		"mrn": str(u.Mrn), "first_name": u.FirstName, "last_name": u.LastName,
		"middle_name": str(u.MiddleName), "full_name": str(u.FullName),
		"email": u.Email, "phone_number": str(u.PhoneNumber),
		"provider": u.Provider, "verified": u.Verified,
		"profile_picture_url": str(u.ProfilePictureUrl),
	}
}

func doctorJSON(d gen.Doctor) map[string]any {
	return map[string]any{
		"_id": d.ID.String(), "doctor_no": d.DoctorNo,
		"first_name": d.FirstName, "last_name": d.LastName,
		"full_name": str(d.FullName), "email": d.Email,
		"phone_number": str(d.PhoneNumber), "active": d.Active,
		"profile_picture_url": str(d.ProfilePictureUrl),
		"specializations":     d.Specializations,
		"license_no":          str(d.LicenseNo),
	}
}

func adminJSON(a gen.Admin) map[string]any {
	return map[string]any{
		"_id": a.ID.String(), "first_name": a.FirstName, "last_name": a.LastName,
		"email": a.Email, "phone_number": str(a.PhoneNumber), "role": a.Role,
	}
}

// displayName/emailOf resolve notice addressing per role.
func displayName(ctx context.Context, s *Service, uid pgtype.UUID, role string) string {
	switch role {
	case RolePatient:
		if u, err := s.q().GetPatientByID(ctx, uid); err == nil {
			return u.FirstName
		}
	case RoleDoctor:
		if d, err := s.q().GetDoctorByID(ctx, uid); err == nil {
			return d.FirstName
		}
	case RoleAdmin:
		if a, err := s.q().GetAdminByID(ctx, uid); err == nil {
			return a.FirstName
		}
	}
	return ""
}

func emailOf(ctx context.Context, s *Service, uid pgtype.UUID, role string) string {
	switch role {
	case RolePatient:
		if u, err := s.q().GetPatientByID(ctx, uid); err == nil {
			return u.Email
		}
	case RoleDoctor:
		if d, err := s.q().GetDoctorByID(ctx, uid); err == nil {
			return d.Email
		}
	case RoleAdmin:
		if a, err := s.q().GetAdminByID(ctx, uid); err == nil {
			return a.Email
		}
	}
	return ""
}
