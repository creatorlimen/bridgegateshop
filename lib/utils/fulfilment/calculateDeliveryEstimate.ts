export type CalendarClosure = {
  date: string;
  open: boolean;
  affectedZoneIds: readonly string[];
};

export type EstimateSchedule = {
  serviceDays: readonly number[];
  cutoffLocalTime: string;
  sameDayEnabled: boolean;
  minimumBusinessDays: number;
  maximumBusinessDays: number;
};

export type CalculateDeliveryEstimateInput = {
  now: Date;
  configurationVersion: string;
  method: 'delivery' | 'pickup';
  zoneId: string | null;
  schedule: EstimateSchedule;
  closures: readonly CalendarClosure[];
  stockImmediatelyAvailable: boolean;
};

export type CalculatedDeliveryEstimate = {
  configurationVersion: string;
  calculatedAt: Date;
  localPlacementDate: string;
  earliestDate: string;
  latestDate: string;
  sameDayQualified: boolean;
  label: string;
  assumptions: string[];
};

const lagosDateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Lagos',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const displayDateFormatter = new Intl.DateTimeFormat('en-NG', {
  timeZone: 'UTC',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function lagosParts(date: Date) {
  const parts = Object.fromEntries(
    lagosDateTimeFormatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function parseCutoffMinutes(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error('Cut-off time must use HH:mm.');
  return Number(match[1]) * 60 + Number(match[2]);
}

function addCalendarDays(localDate: string, days: number) {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dayOfWeek(localDate: string) {
  return new Date(`${localDate}T00:00:00.000Z`).getUTCDay();
}

function isAvailableDate(
  localDate: string,
  zoneId: string | null,
  schedule: EstimateSchedule,
  closures: readonly CalendarClosure[],
) {
  if (!schedule.serviceDays.includes(dayOfWeek(localDate))) return false;
  return !closures.some(
    (closure) =>
      closure.date === localDate &&
      !closure.open &&
      (closure.affectedZoneIds.length === 0 ||
        (zoneId !== null && closure.affectedZoneIds.includes(zoneId))),
  );
}

function advanceAvailableDays(
  fromDate: string,
  days: number,
  zoneId: string | null,
  schedule: EstimateSchedule,
  closures: readonly CalendarClosure[],
) {
  let candidate = fromDate;
  let remaining = days;
  let inspectedDays = 0;
  while (remaining > 0 || !isAvailableDate(candidate, zoneId, schedule, closures)) {
    candidate = addCalendarDays(candidate, 1);
    inspectedDays += 1;
    if (inspectedDays > 370) {
      throw new Error('No available fulfilment date was found within one year.');
    }
    if (isAvailableDate(candidate, zoneId, schedule, closures)) remaining -= 1;
  }
  return candidate;
}

function displayDate(localDate: string) {
  return displayDateFormatter.format(new Date(`${localDate}T00:00:00.000Z`));
}

export function calculateDeliveryEstimate(
  input: CalculateDeliveryEstimateInput,
): CalculatedDeliveryEstimate {
  if (
    input.schedule.maximumBusinessDays < input.schedule.minimumBusinessDays ||
    input.schedule.minimumBusinessDays < 0
  ) {
    throw new Error('The fulfilment business-day range is invalid.');
  }
  const local = lagosParts(input.now);
  const cutoffMinutes = parseCutoffMinutes(input.schedule.cutoffLocalTime);
  const todayAvailable = isAvailableDate(
    local.date,
    input.zoneId,
    input.schedule,
    input.closures,
  );
  const beforeCutoff = local.minutes < cutoffMinutes;
  const sameDayQualified = Boolean(
    input.schedule.sameDayEnabled &&
      input.stockImmediatelyAvailable &&
      todayAvailable &&
      beforeCutoff,
  );
  const cutoffDelay = beforeCutoff ? 0 : 1;
  const earliestDate = sameDayQualified
    ? local.date
    : advanceAvailableDays(
        local.date,
        Math.max(1, input.schedule.minimumBusinessDays + cutoffDelay),
        input.zoneId,
        input.schedule,
        input.closures,
      );
  const latestDays = sameDayQualified
    ? Math.max(0, input.schedule.maximumBusinessDays)
    : Math.max(1, input.schedule.maximumBusinessDays + cutoffDelay);
  const latestDate = advanceAvailableDays(
    local.date,
    latestDays,
    input.zoneId,
    input.schedule,
    input.closures,
  );
  const methodLabel = input.method === 'pickup' ? 'Pickup' : 'Delivery';
  const label =
    earliestDate === latestDate
      ? `${methodLabel} expected ${displayDate(earliestDate)}.`
      : `${methodLabel} expected ${displayDate(earliestDate)}–${displayDate(latestDate)}.`;
  const assumptions = [
    'Africa/Lagos business time',
    'Configured service days and closures',
    input.stockImmediatelyAvailable
      ? 'Current stock is immediately available'
      : 'Additional stock handling may apply',
    beforeCutoff ? 'Placed before the local cut-off' : 'Placed at or after the local cut-off',
  ];

  return {
    configurationVersion: input.configurationVersion,
    calculatedAt: new Date(input.now),
    localPlacementDate: local.date,
    earliestDate,
    latestDate,
    sameDayQualified,
    label,
    assumptions,
  };
}
