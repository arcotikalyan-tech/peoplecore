import { redirect } from 'next/navigation';

/** Leave settings moved into the Leave hub (Settings, Leave rules and Balances tabs). */
export default async function LeaveSettingsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  redirect(`/app/${org}/leave?tab=settings`);
}
