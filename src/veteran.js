const { getAccessToken } = require('./auth');

const BASE         = process.env.VA_API_BASE;
const LETTER_BASE  = process.env.VA_LETTER_BASE;
const LETTER_CREDS = {
  tokenUrl: process.env.VA_LETTER_TOKEN_URL,
  clientId: process.env.VA_LETTER_CLIENT_ID,
  audience: process.env.VA_LETTER_AUDIENCE,
};

const EDUCATION_ENDPOINT = process.env.VA_EDUCATION_BENEFITS_BASE;
const EDUCATION_CREDS = {
  tokenUrl: process.env.VA_EDUCATION_BENEFITS_TOKEN_URL,
  clientId: process.env.VA_EDUCATION_BENEFITS_CLIENT_ID,
  audience: process.env.VA_EDUCATION_BENEFITS_AUDIENCE,
};

const STEPS = Object.freeze({
  STATUS:   'status',
  PT:       'pt',
  RATING:   'rating',
  ENROLLED: 'enrolled',
  LETTERS:  'letters',
  CH33:     'ch33',
});

function buildDemographics(veteran) {
  return {
    first_name:           veteran.firstName,
    last_name:            veteran.lastName,
    ...(veteran.dob      && { birth_date: veteran.dob }),
    street_address_line1: veteran.address,
    ...(veteran.address2 && { street_address_line2: veteran.address2 }),
    city:                 veteran.city,
    state:                veteran.state,
    zipcode:              veteran.zip,
    country:              veteran.country || 'USA',
    ...(veteran.middleName && { middle_name: veteran.middleName }),
    ...(veteran.maidenName && { mothers_maiden_name: veteran.maidenName }),
  };
}

function log(step, msg) {
  console.log(`  [${step}] ${msg}`);
}

function errMsg(err) {
  return err.response?.data ? JSON.stringify(err.response.data) : err.message;
}

async function apiFetch(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const err = new Error(`HTTP ${res.status}`);
    err.response = { data };
    throw err;
  }
  return res.json();
}

async function checkVeteranStatus(veteran) {
  const payload = buildDemographics(veteran);
  log(STEPS.STATUS, `POST /status - fields: ${Object.keys(payload).join(', ')}`);
  const token = await getAccessToken('veteran_status.read');

  const json = await apiFetch(`${BASE}/status`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data  = json?.data;
  const attrs = data?.attributes;
  const result = {
    confirmed:          attrs?.veteran_status === 'confirmed',
    notConfirmedReason: attrs?.not_confirmed_reason || null,
    icn:                data?.id || null,
  };
  log(STEPS.STATUS, `→ ${result.confirmed ? 'confirmed' : 'not confirmed'}${result.notConfirmedReason ? ' (' + result.notConfirmedReason + ')' : ''} | ICN: ${result.icn ?? 'none'}`);
  return result;
}

async function checkPermanentAndTotal(veteran) {
  log(STEPS.PT, 'POST /permanent_and_total_disability');
  const token = await getAccessToken('permanent_and_total_disability.read');

  const json = await apiFetch(`${BASE}/permanent_and_total_disability`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildDemographics(veteran)),
  });

  const pt   = json?.data?.permanent_and_total;
  const tdiu = json?.data?.total_disability;
  const result = {
    isPermanentAndTotal: (pt?.service_connected_status || pt?.pension_award_status) ?? false,
    isTdiu:              tdiu?.status ?? false,
    effectiveDate:       tdiu?.effective_date || null,
  };
  log(STEPS.PT, `→ P&T: ${result.isPermanentAndTotal}, TDIU: ${result.isTdiu}`);
  return result;
}

async function checkDisabilityRating(veteran) {
  log(STEPS.RATING, 'POST /summary/disability_rating');
  const token = await getAccessToken('disability_rating_summary.read');

  const json = await apiFetch(`${BASE}/summary/disability_rating`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildDemographics(veteran)),
  });

  const attrs = json?.data?.attributes;
  const result = { combinedRating: attrs?.combined_disability_rating ?? null };
  log(STEPS.RATING, `→ combined: ${result.combinedRating ?? 'null'}`);
  return result;
}

async function checkEnrolledBenefits(veteran) {
  log(STEPS.ENROLLED, 'POST /enrolled_benefits');
  const token = await getAccessToken('enrolled_benefits.read');

  const json = await apiFetch(`${BASE}/enrolled_benefits`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildDemographics(veteran)),
  });

  const benefits = json?.veteran_benefits || [];
  log(STEPS.ENROLLED, `→ ${benefits.length} benefit(s): ${benefits.map(b => b.program_code).join(', ') || 'none'}`);
  return benefits;
}

async function getEligibleLetters(icn) {
  log(STEPS.LETTERS, `GET /eligible-letters?icn=${icn}`);
  const token = await getAccessToken('letters.read', null, LETTER_CREDS);

  const url = new URL(`${LETTER_BASE}/eligible-letters`);
  url.searchParams.set('icn', icn);

  const json = await apiFetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const letters = json?.letters || [];
  log(STEPS.LETTERS, `→ ${letters.length} eligible: ${letters.map(l => l.letterType).join(', ') || 'none'}`);
  return letters;
}

async function fetchLetterPdf(icn, letterType) {
  log(STEPS.LETTERS, `GET /letters/${letterType}/letter?icn=${icn}`);
  const token = await getAccessToken('letters.read', null, LETTER_CREDS);

  const url = new URL(`${LETTER_BASE}/letters/${letterType}/letter`);
  url.searchParams.set('icn', icn);
  if (letterType === 'BENEFIT_SUMMARY') url.searchParams.set('monthlyAward', 'false');

  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const err = new Error(`HTTP ${response.status}`);
    err.response = { data };
    throw err;
  }
  return response;
}

async function checkChapter33(icn) {
  log(STEPS.CH33, `GET chapter33?icn=${icn}`);
  const token = await getAccessToken('education.read', null, EDUCATION_CREDS);

  const url = new URL(EDUCATION_ENDPOINT);
  url.searchParams.set('icn', icn);

  const json = await apiFetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const remaining = json?.chapter33EducationInfo?.remainingEntitlement;
  const months = remaining?.months ?? 0;
  const days   = remaining?.days   ?? 0;
  const result = {
    remainingMonths: remaining?.months ?? null,
    remainingDays:   remaining?.days   ?? null,
    hasEntitlement:  months > 0 || days > 0,
  };
  log(STEPS.CH33, `→ remaining: ${result.remainingMonths}mo ${result.remainingDays}d`);
  return result;
}

async function runDependentLookup(parent) {
  const result = { parent, status: null, pt: null, deaEligible: false, errors: [] };

  try {
    result.status = await checkVeteranStatus(parent);
  } catch (err) {
    result.errors.push({ step: STEPS.STATUS, message: errMsg(err) });
    return result;
  }

  if (!result.status.confirmed) return result;

  try {
    result.pt = await checkPermanentAndTotal(parent);
    result.deaEligible = result.pt.isPermanentAndTotal || result.pt.isTdiu;
  } catch (err) {
    result.errors.push({ step: STEPS.PT, message: errMsg(err) });
  }

  return result;
}

async function runVeteranLookup(veteran) {
  const result = {
    veteran,
    icn:      null,
    status:   null,
    pt:       null,
    rating:   null,
    enrolled: null,
    letters:  null,
    ch33:     null,
    errors:   [],
  };

  try {
    result.status = await checkVeteranStatus(veteran);
    result.icn    = result.status.icn;
  } catch (err) {
    result.errors.push({ step: STEPS.STATUS, message: errMsg(err) });
    return result;
  }

  if (!result.status.confirmed) return result;

  // All post-status lookups are independent - run in parallel
  const [ptRes, ratingRes, enrolledRes, lettersRes, ch33Res] = await Promise.allSettled([
    checkPermanentAndTotal(veteran),
    checkDisabilityRating(veteran),
    checkEnrolledBenefits(veteran),
    result.icn ? getEligibleLetters(result.icn)  : Promise.resolve(null),
    result.icn ? checkChapter33(result.icn)       : Promise.resolve(null),
  ]);

  if (ptRes.status       === 'fulfilled') result.pt       = ptRes.value;
  else result.errors.push({ step: STEPS.PT,       message: errMsg(ptRes.reason) });

  if (ratingRes.status   === 'fulfilled') result.rating   = ratingRes.value;
  else result.errors.push({ step: STEPS.RATING,   message: errMsg(ratingRes.reason) });

  if (enrolledRes.status === 'fulfilled') result.enrolled = enrolledRes.value;
  else result.errors.push({ step: STEPS.ENROLLED, message: errMsg(enrolledRes.reason) });

  if (lettersRes.status  === 'fulfilled') result.letters  = lettersRes.value;
  else result.errors.push({ step: STEPS.LETTERS,  message: errMsg(lettersRes.reason) });

  if (ch33Res.status     === 'fulfilled') result.ch33     = ch33Res.value;
  else result.errors.push({ step: STEPS.CH33,     message: errMsg(ch33Res.reason) });

  return result;
}

module.exports = {
  checkVeteranStatus,
  checkPermanentAndTotal,
  checkDisabilityRating,
  checkEnrolledBenefits,
  getEligibleLetters,
  fetchLetterPdf,
  checkChapter33,
  runDependentLookup,
  runVeteranLookup,
};
