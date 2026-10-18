import type { Database } from '@peoplecore/db/types';

export type CourseFormat = Database['public']['Enums']['course_format'];
export type EnrollmentStatus = Database['public']['Enums']['enrollment_status'];

export const FORMAT_LABEL: Record<CourseFormat, string> = {
  online: 'Online course',
  classroom: 'Classroom session',
  video: 'Video',
  reading: 'Reading',
  external: 'External programme',
};

export const STATUS_LABEL: Record<EnrollmentStatus, string> = {
  assigned: 'Not started',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const STATUS_TONE: Record<EnrollmentStatus, 'neutral' | 'primary' | 'success'> = {
  assigned: 'neutral',
  in_progress: 'primary',
  completed: 'success',
  cancelled: 'neutral',
};

export const duration = (minutes: number | null) =>
  minutes == null ? null : minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
