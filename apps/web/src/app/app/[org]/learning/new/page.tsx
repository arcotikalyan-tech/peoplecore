import type { Metadata } from 'next';
import { Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { requirePermission } from '@/server/context';
import { saveCourseAction } from '../actions';
import { CourseForm } from '../learning-forms';

export const metadata: Metadata = { title: 'New course' };

export default async function NewCoursePage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  await requirePermission(slug, 'learning.manage', 'org');
  return (
    <>
      <PageHeader title="New course" description="Add it once; assign it to people or let them enrol themselves." />
      <Card><CardHeader title="Course" /><CourseForm action={saveCourseAction.bind(null, slug)} /></Card>
    </>
  );
}
