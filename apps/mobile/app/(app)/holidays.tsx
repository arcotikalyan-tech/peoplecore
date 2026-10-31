import { todayIn } from '@peoplecore/shared/dates';
import { useState } from 'react';
import { View } from 'react-native';
import { DateLeaf } from '@/components/quick-actions';
import { dateParts, monthYear, relativeDay } from '@/lib/format';
import { loadHolidays } from '@/lib/holidays';
import { useSession } from '@/lib/session';
import { useLoad } from '@/lib/use-load';
import { Card, EmptyState, ErrorState, ListGroup, ListRow, Page, Pill, Segmented, SkeletonList, Text } from '@/ui';

/** The year's holidays on your own calendar, month by month; optional (restricted) ones are marked. */
export default function Holidays() {
  const { workplace } = useSession();
  const today = todayIn(workplace?.timezone ?? 'Asia/Kolkata');
  const thisYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const { data, loading, error, reload } = useLoad(
    async () => (workplace ? loadHolidays(workplace.orgId, `${year}-01-01`, `${year}-12-31`, 100) : []),
    [workplace, year],
  );
  const left = data?.filter((h) => h.holiday_date >= today).length ?? 0;
  const months = [...new Set((data ?? []).map((h) => h.holiday_date.slice(0, 7)))];

  return (
    <Page onRefresh={reload}>
      <Segmented value={String(year)} onChange={(v) => setYear(Number(v))}
        options={[{ value: String(thisYear), label: String(thisYear) }, { value: String(thisYear + 1), label: String(thisYear + 1) }]} />
      {loading ? <SkeletonList rows={5} /> : error ? <Card><ErrorState onRetry={() => void reload()} /></Card> : !data?.length ? (
        <Card><EmptyState icon="sunny-outline" title={`No holidays listed for ${year}`} body="Your HR team publishes the holiday calendar. Check back later." /></Card>
      ) : (
        <>
          {year === thisYear && <Text variant="footnote" tone="muted">{left} of {data.length} holidays still to come this year</Text>}
          {months.map((m) => (
            <ListGroup key={m} title={monthYear(m)}>
              {data.filter((h) => h.holiday_date.startsWith(m)).map((h) => {
                const p = dateParts(h.holiday_date);
                const past = h.holiday_date < today;
                const label = relativeDay(h.holiday_date, today);
                return (
                  <ListRow key={h.holiday_date + h.name} title={h.name}
                    leading={<View style={{ opacity: past ? 0.45 : 1 }}><DateLeaf month={p.month} day={p.day} tone={h.is_optional ? 'accent' : 'primary'} /></View>}
                    subtitle={`${p.weekday}${h.is_optional ? ' · Optional holiday' : ''}${past ? ' · Passed' : ''}`}
                    right={label === 'Today' || label === 'Tomorrow' ? <Pill label={label} tone="success" /> : h.is_optional ? <Pill label="Optional" tone="accent" /> : undefined} />
                );
              })}
            </ListGroup>
          ))}
        </>
      )}
    </Page>
  );
}
