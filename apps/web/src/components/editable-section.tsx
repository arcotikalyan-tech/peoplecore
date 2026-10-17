'use client';

import { useState, type ReactNode } from 'react';
import { Button } from './ui/button';
import { Card, CardHeader } from './ui/surface';

/**
 * A card that switches between a read-only view and an editor. The page re-keys it whenever the
 * underlying record changes, so a successful save closes the editor.
 */
export function EditableSection({
  title, description, canEdit, editLabel = 'Edit', view, children,
}: {
  title: string;
  description?: string;
  canEdit: boolean;
  editLabel?: string;
  view: ReactNode;
  children?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <Card>
      <CardHeader
        title={title}
        description={description}
        actions={canEdit && (
          <Button size="sm" variant="secondary" onClick={() => setEditing(!editing)} aria-expanded={editing}>
            {editing ? 'Cancel' : editLabel}
          </Button>
        )}
      />
      {editing ? children : view}
    </Card>
  );
}
