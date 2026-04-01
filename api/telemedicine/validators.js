// Validators for telemedicine data
export const validateDoctorSignup = (data) => {
  const errors = [];

  if (!data.full_name || data.full_name.trim().length < 2) {
    errors.push('Full name must be at least 2 characters');
  }

  if (!data.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    errors.push('Valid email is required');
  }

  if (!data.specialty || data.specialty.trim().length < 2) {
    errors.push('Specialty is required');
  }

  if (!data.license_number || data.license_number.trim().length < 5) {
    errors.push('Valid license number is required');
  }

  if (!data.price_per_session || data.price_per_session <= 0) {
    errors.push('Valid price per session is required');
  }

  if (!data.bio || data.bio.trim().length < 10) {
    errors.push('Bio must be at least 10 characters');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

export const validateBooking = (data) => {
  const errors = [];

  if (!data.doctor_id) {
    errors.push('Doctor ID is required');
  }

  if (!data.scheduled_time) {
    errors.push('Scheduled time is required');
  }

  const scheduledTime = new Date(data.scheduled_time);
  if (isNaN(scheduledTime.getTime())) {
    errors.push('Invalid scheduled time format');
  }

  if (scheduledTime <= new Date()) {
    errors.push('Scheduled time must be in the future');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

export const validateMessage = (data) => {
  const errors = [];

  if (!data.booking_id) {
    errors.push('Booking ID is required');
  }

  if (!data.sender_id) {
    errors.push('Sender ID is required');
  }

  if (!data.content || data.content.trim().length === 0) {
    errors.push('Message content is required');
  }

  if (data.content && data.content.length > 1000) {
    errors.push('Message content must be less than 1000 characters');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};