// Slice 3: the daily round, the tanks, the invoices, and the sums.
const { session } = require('./session');
let fail = 0;
let req;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + m); if (!c) fail++; };

(async () => {
  ({ req } = await session());
  ok(true, 'signed in (shared session)');

  const stamp = Date.now();
  const prop = (await req('POST', '/properties', { name: 'Utilities ' + stamp })).body;
  await req('PUT', `/properties/${prop.id}`, { centerLat: 13.99, centerLng: -61.0 });

  // ---- the three ways a thing gets read -------------------------------
  let r = await req('POST', '/utilities/meters', {
    propertyId: prop.id, name: 'Main meter', kind: 'electricity', entryMode: 'direct', unit: 'kWh',
  });
  ok(r.status === 201, `an electricity meter can be set up (${r.status})`);
  const main = r.body;
  ok(main.cumulative === true, 'and is cumulative by default, being a meter');

  r = await req('POST', '/utilities/meters', {
    propertyId: prop.id, name: 'Chiller plant', kind: 'electricity', entryMode: 'direct', unit: 'kWh',
    includeInSiteTotal: false,
  });
  const submeter = r.body;
  ok(submeter.includeInSiteTotal === false, 'a submeter can be kept out of the site total');

  r = await req('POST', '/utilities/meters', {
    propertyId: prop.id, name: 'Propane bulk 1', kind: 'propane', entryMode: 'percentage',
    unit: 'litre', capacityLitres: 4000,
  });
  ok(r.status === 201, `a propane tank read as a percentage (${r.status})`);
  const propane = r.body;
  ok(propane.cumulative === false, 'and is not cumulative, being a level');

  r = await req('POST', '/utilities/meters', {
    propertyId: prop.id, name: 'Water tank', kind: 'water', entryMode: 'tank_height',
    unit: 'litre', capacityLitres: 50000, tankMaxHeightMm: 2500,
  });
  ok(r.status === 201, 'and a water tank read by height');
  const water = r.body;

  // A tank with nothing to convert against is refused up front.
  r = await req('POST', '/utilities/meters', {
    propertyId: prop.id, name: 'Bad tank', kind: 'diesel', entryMode: 'percentage', unit: 'litre',
  });
  ok(r.status === 400, `a percentage tank with no capacity is refused (${r.status})`);
  r = await req('POST', '/utilities/meters', {
    propertyId: prop.id, name: 'Bad tank 2', kind: 'diesel', entryMode: 'tank_height', unit: 'litre', capacityLitres: 1000,
  });
  ok(r.status === 400, 'and one read by height with no full height');
  r = await req('POST', '/utilities/meters', { propertyId: prop.id, name: 'X', kind: 'unicorns', unit: 'kWh' });
  ok(r.status === 400, `an invented utility is refused (${r.status})`);

  // ---- conversions happen on the way in --------------------------------
  r = await req('POST', '/utilities/readings', { meterPointId: propane.id, slot: '0500', rawValue: 47, readingDay: '2026-11-16' });
  ok(r.status === 201, `a percentage reading is accepted (${r.status})`);
  ok(r.body.rawValue === 47, 'keeping what was written down');
  ok(r.body.value === 1880, `and converting it to 1880 litres (${r.body.value})`);

  r = await req('POST', '/utilities/readings', { meterPointId: water.id, slot: '0500', rawValue: 1250, readingDay: '2026-11-16' });
  ok(r.body.value === 25000, `a height of 1250mm is 25,000 litres (${r.body.value})`);

  r = await req('POST', '/utilities/readings', { meterPointId: propane.id, slot: '0500', rawValue: 140, readingDay: '2026-11-17' });
  ok(r.status === 400, `a percentage over a hundred is refused (${r.status})`);
  r = await req('POST', '/utilities/readings', { meterPointId: water.id, slot: '0500', rawValue: 3000, readingDay: '2026-11-17' });
  ok(r.status === 400, 'and a height above the tank');
  r = await req('POST', '/utilities/readings', { meterPointId: main.id, slot: '0300', rawValue: 1 });
  ok(r.status === 400, `a round that is not one of the two is refused (${r.status})`);

  // ---- a second entry for the same round is a correction ---------------
  r = await req('POST', '/utilities/readings', { meterPointId: propane.id, slot: '0500', rawValue: 52, readingDay: '2026-11-16' });
  ok(r.status === 201 && r.body.value === 2080, `re-entering a round corrects it (${r.body.value})`);
  const oneDay = (await req('GET', `/utilities/readings?propertyId=${prop.id}&day=2026-11-16`)).body;
  const propaneRow = oneDay.rows.find(x => x.meter.id === propane.id);
  ok(!!propaneRow.readings['0500'] && propaneRow.readings['0500'].rawValue === 52,
     'rather than leaving two readings for one round');

  // ---- the 05:00 day boundary, through the API -------------------------
  // A round taken at 02:00 on the 18th belongs to the 17th.
  r = await req('POST', '/utilities/readings', {
    meterPointId: main.id, slot: '0200', rawValue: 500, takenAt: '2026-11-18T02:00:00Z',
  });
  ok(r.body.readingDay === '2026-11-17',
     `a 02:00 round is filed under the day before (${r.body.readingDay})`);
  r = await req('POST', '/utilities/readings', {
    meterPointId: main.id, slot: '0500', rawValue: 400, takenAt: '2026-11-17T05:00:00Z',
  });
  ok(r.body.readingDay === '2026-11-17', 'and the 05:00 round opens that same day');

  // ---- a week of electricity, and the sums ------------------------------
  // 05:00 opens each day; 02:00 sits three hours before it closes.
  const series = [
    ['2026-11-16', '0500', 1000], ['2026-11-16', '0200', 1090],
    ['2026-11-17', '0500', 1100], ['2026-11-17', '0200', 1185],
    ['2026-11-18', '0500', 1200], ['2026-11-18', '0200', 1290],
    ['2026-11-19', '0500', 1300],
  ];
  for (const [day, slot, raw] of series) {
    await req('POST', '/utilities/readings', { meterPointId: main.id, slot, rawValue: raw, readingDay: day });
  }

  r = await req('GET', `/utilities/summary?propertyId=${prop.id}&today=2026-11-18&from=2026-11-01`);
  ok(r.status === 200, `the summary reads (${r.status})`);
  const mainEntry = r.body.meters.find(m => m.meter.id === main.id);
  ok(!!mainEntry, 'with an entry per meter');
  const d16 = mainEntry.days.find(d => d.day === '2026-11-16');
  ok(d16.used === 100, `the 16th used 100 (${d16.used})`);
  ok(d16.usedTrading === 90 && d16.usedOvernight === 10,
     `split 90 open and 10 overnight (${d16.usedTrading}/${d16.usedOvernight})`);
  // The 19th's opening reading exists, so the 18th closed: three days count.
  ok(mainEntry.totals.mtd === 300, `three closed days is 300 month to date (${mainEntry.totals.mtd})`);
  ok(mainEntry.totals.days.mtd === 3, `over three counted days (${mainEntry.totals.days.mtd})`);

  // The site total excludes the submeter.
  ok(r.body.siteTotals.electricity.meters === 1,
     `only the rolling-up meter counts toward the site total (${r.body.siteTotals.electricity.meters})`);
  ok(r.body.siteTotals.electricity.mtd === 300, `so the site figure is 300 (${r.body.siteTotals.electricity.mtd})`);

  // Nothing was actually missed inside the window, and the window does not reach
  // back before this meter was first read — otherwise a meter installed yesterday
  // reports a fortnight of false alarms.
  ok(mainEntry.missing.length === 0, `no false alarms before the meter existed (${mainEntry.missing.length})`);

  // Now skip a round and check it is named.
  await req('POST', '/utilities/readings', { meterPointId: main.id, slot: '0500', rawValue: 1400, readingDay: '2026-11-20' });
  r = await req('GET', `/utilities/summary?propertyId=${prop.id}&today=2026-11-20&from=2026-11-01`);
  const withGap = r.body.meters.find(m => m.meter.id === main.id);
  const missed = withGap.missing.find(m => m.day === '2026-11-19');
  ok(!!missed && missed.missing.includes('0200'), 'a round that was skipped is named');
  ok(!withGap.missing.some(m => m.day < '2026-11-16'), 'and nothing before the first reading is');

  // ---- cost per unit comes from the invoice ----------------------------
  r = await req('POST', '/utilities/invoices', {
    propertyId: prop.id, kind: 'electricity', periodStart: '2026-09-01', periodEnd: '2026-09-30',
    amount: 120000, quantity: 300000, unit: 'kWh', reference: 'LUCELEC-9',
  });
  ok(r.status === 201, `an invoice can be recorded (${r.status})`);
  r = await req('POST', '/utilities/invoices', {
    propertyId: prop.id, kind: 'electricity', periodStart: '2026-10-01', periodEnd: '2026-10-31',
    amount: 156000, quantity: 300000, unit: 'kWh',
  });
  ok(r.status === 201, 'and a second one');

  r = await req('GET', `/utilities/invoices?propertyId=${prop.id}`);
  const elec = r.body.costs.electricity;
  ok(elec.length === 2, `both periods are priced (${elec.length})`);
  ok(elec[0].costPerUnit === 0.4 && elec[1].costPerUnit === 0.52,
     `cost per unit is derived (${elec[0].costPerUnit} then ${elec[1].costPerUnit})`);
  ok(elec[1].changePercent === 30,
     `and the rise is computed from the bills rather than taken on trust (${elec[1].changePercent}%)`);

  r = await req('POST', '/utilities/invoices', {
    propertyId: prop.id, kind: 'water', periodStart: '2026-10-01', periodEnd: '2026-10-31',
    amount: 5000, quantity: 0, unit: 'litre',
  });
  ok(r.status === 400, `an invoice with no quantity is refused — there would be no unit cost (${r.status})`);
  r = await req('POST', '/utilities/invoices', {
    propertyId: prop.id, kind: 'water', periodStart: '2026-10-31', periodEnd: '2026-10-01',
    amount: 5000, quantity: 100, unit: 'litre',
  });
  ok(r.status === 400, 'and one whose period ends before it starts');

  // Re-recording the same period replaces it.
  r = await req('POST', '/utilities/invoices', {
    propertyId: prop.id, kind: 'electricity', periodStart: '2026-10-01', periodEnd: '2026-10-31',
    amount: 150000, quantity: 300000, unit: 'kWh',
  });
  const again = (await req('GET', `/utilities/invoices?propertyId=${prop.id}&kind=electricity`)).body;
  ok(again.invoices.length === 2, `correcting an invoice does not add a second (${again.invoices.length})`);
  ok(again.costs.electricity[1].costPerUnit === 0.5, 'and the unit cost follows the correction');

  // ---- a meter with history is retired, not deleted --------------------
  r = await req('DELETE', `/utilities/meters/${main.id}`);
  ok(r.status === 200 && r.body.deactivated === true,
     `a meter with readings is taken out of use rather than deleted (${r.status})`);
  ok(/history is kept/.test(r.body.message ?? ''), 'and says why');
  const after = (await req('GET', `/utilities/meters?propertyId=${prop.id}`)).body;
  ok(!after.meters.some(m => m.id === main.id), 'it drops off the round');
  const all = (await req('GET', `/utilities/meters?propertyId=${prop.id}&all=1`)).body;
  ok(all.meters.some(m => m.id === main.id), 'but is still there with its history');

  r = await req('DELETE', `/utilities/meters/${submeter.id}`);
  ok(r.status === 204, `one with no readings deletes outright (${r.status})`);

  console.log(fail === 0 ? '\nALL CHECKS PASSED' : `\n${fail} CHECK(S) FAILED`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('THREW:', e.message, e.stack); process.exit(2); });
