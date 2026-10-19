import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { assetCategories } from '@/server/assets';
import { requirePermission } from '@/server/context';
import { getStructure, structureOptions } from '@/server/structure';
import { saveAssetAction } from '../actions';
import { AssetForm } from '../assets-forms';

export const metadata: Metadata = { title: 'Add asset' };

export default async function NewAssetPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await requirePermission(slug, 'asset.manage', 'org');
  const [structure, categories] = await Promise.all([getStructure(ctx.org.id), assetCategories(ctx.org.id)]);
  const { locations } = structureOptions(structure);
  return (
    <>
      <PageHeader title="Add asset" description="Record it once; issue it to people and take it back as often as needed." />
      <Card><CardHeader title="Asset" /><AssetForm action={saveAssetAction.bind(null, slug)} locations={locations}
        categories={categories.map((c) => ({ value: c.id, label: c.name }))} /></Card>
      <p className="mt-3 text-sm text-muted">Category missing? <Link className="text-primary hover:underline" href={`/app/${slug}/assets?tab=categories`}>Add it on the Categories tab</Link>.</p>
    </>
  );
}
