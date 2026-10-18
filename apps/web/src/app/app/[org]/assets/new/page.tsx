import type { Metadata } from 'next';
import { Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { requirePermission } from '@/server/context';
import { getStructure, structureOptions } from '@/server/structure';
import { saveAssetAction } from '../actions';
import { AssetForm } from '../assets-forms';

export const metadata: Metadata = { title: 'Add asset' };

export default async function NewAssetPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await requirePermission(slug, 'asset.manage', 'org');
  const { locations } = structureOptions(await getStructure(ctx.org.id));
  return (
    <>
      <PageHeader title="Add asset" description="Record it once; issue it to people and take it back as often as needed." />
      <Card><CardHeader title="Asset" /><AssetForm action={saveAssetAction.bind(null, slug)} locations={locations} /></Card>
    </>
  );
}
