'use client';

import { useState } from 'react';
import { COUNTRIES, INDIA_STATES, citiesOf, findState, type StateCode } from '@peoplecore/shared';
import { FormResetScope } from '../form-reset-scope';
import { FieldShell, SelectField, aria, controlClass, fieldId } from './fields';
import { cn } from './cn';

const OTHER = '__other';

interface PlaceFieldsProps {
  idPrefix: string;
  /** Field names; leave out `country` where the form doesn't store one. */
  names: { country?: string; state: string; city: string };
  /** What the state dropdown submits: the code ("KA") or the name ("Karnataka"). */
  stateAs: 'code' | 'name';
  values: { country?: string | null; state?: string | null; city?: string | null };
  errors?: { country?: string; state?: string; city?: string };
  labels?: { country?: string; state?: string; city?: string };
  cityRequired?: boolean;
}

/**
 * Country, State and City dropdowns (India only for now). City lists the chosen state's cities, and "Other" opens a
 * box for one that isn't listed. Saved values the lists don't know are kept as they are.
 */
export function PlaceFields(props: PlaceFieldsProps) {
  return <FormResetScope><Places {...props} /></FormResetScope>;
}

function Places({ idPrefix, names, stateAs, values, errors = {}, labels = {}, cityRequired }: PlaceFieldsProps) {
  const savedState = values.state?.trim() ?? '';
  const savedCode = findState(savedState);
  const savedCity = values.city?.trim() ?? '';
  const listedCity = savedCode ? citiesOf(savedCode).find((c) => c.toLowerCase() === savedCity.toLowerCase()) : undefined;
  const [code, setCode] = useState<StateCode | null>(savedCode);
  const [other, setOther] = useState(!!savedCity && !listedCity);

  const country = values.country?.trim() || COUNTRIES[0];
  const stateOptions = [
    ...INDIA_STATES.map((s) => ({ value: stateAs === 'code' ? s.code : s.name, label: s.name })),
    ...(savedState && !savedCode ? [{ value: savedState, label: savedState }] : []),
  ];
  const cities = code ? citiesOf(code) : [];
  const cityLabel = labels.city ?? 'City';
  const cityId = fieldId(names.city, idPrefix);
  const cityDefault = other ? OTHER : code === savedCode ? (listedCity ?? '') : '';

  return (
    <>
      {names.country && (
        <SelectField idPrefix={idPrefix} name={names.country} label={labels.country ?? 'Country'} defaultValue={country} error={errors.country}
          options={[...COUNTRIES, ...((COUNTRIES as readonly string[]).includes(country) ? [] : [country])].map((c) => ({ value: c, label: c }))} />
      )}
      <SelectField idPrefix={idPrefix} name={names.state} label={labels.state ?? 'State'} placeholder="Choose…" error={errors.state}
        defaultValue={savedCode ? (stateAs === 'code' ? savedCode : INDIA_STATES.find((s) => s.code === savedCode)!.name) : savedState}
        onChange={(e) => setCode(findState(e.target.value))} options={stateOptions} />
      <FieldShell id={cityId} label={cityLabel} error={errors.city} required={cityRequired}>
        <select key={code ?? ''} name={other ? undefined : names.city} defaultValue={cityDefault} onChange={(e) => setOther(e.target.value === OTHER)}
          className={cn(controlClass(!!errors.city), 'h-10 pr-8')} {...aria(cityId, errors.city)}>
          <option value="">{code ? 'Choose…' : 'Choose a state first'}</option>
          {cities.map((c) => <option key={c} value={c}>{c}</option>)}
          <option value={OTHER}>Other (type it)</option>
        </select>
        {other && (
          <input name={names.city} defaultValue={listedCity ? '' : savedCity} placeholder="Type the city" aria-label={`${cityLabel} name`}
            autoFocus={!savedCity} className={cn(controlClass(!!errors.city), 'mt-2 h-10')} />
        )}
      </FieldShell>
    </>
  );
}
