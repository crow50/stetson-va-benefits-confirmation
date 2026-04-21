require('dotenv').config();
const path = require('path');
const { Readable } = require('stream');
const express = require('express');
const session = require('express-session');
const { runVeteranLookup, runDependentLookup, fetchLetterPdf } = require('./veteran');

const app = express();
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
app.use(express.static(path.join(__dirname, '..', 'public')));
app.set('views', path.join(__dirname, '..', 'views'));
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 8 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === 'production',
  },
}));

function requireAuth(req, res, next) {
  if (!req.session.student) return res.redirect('/login');
  next();
}

const PROGRAM_LABELS = {
  C:      'Compensation',
  PA:     'Pension with Aid & Attendance',
  SCBB:   'Service-Connected Benefits - Basic',
  '306P': '306 Pension',
  OLP:    'Old Law Pension',
  IP:     'Improved Pension',
  REPS:   'Restored Entitlement Program for Survivors',
  DIC:    'Dependency and Indemnity Compensation',
  SURV:   'Survivors Pension',
};

const EXCLUDED_LETTER_TYPES = new Set([
  'BENEFIT_VERIFICATION',
  'FOREIGN_MEDICAL_PROGRAM',
  'MINIMUM_ESSENTIAL_COVERAGE',
  'CIVIL_SERVICE',
  'SERVICE_VERIFICATION',
  'MEDICARE_PARTD',
  'PROOF_OF_SERVICE',
]);

app.locals.PROGRAM_LABELS = PROGRAM_LABELS;
app.locals.EXCLUDED_LETTER_TYPES = EXCLUDED_LETTER_TYPES;

const sentLettersLog = [];

function errMsg(err) {
  return err.response?.data ? JSON.stringify(err.response.data) : err.message;
}

async function handleLookup(b) {
  const affiliation = b.affiliationType;
  console.log(`\n[lookup] affiliation: ${affiliation}`);

  if (affiliation === 'none') {
    return { resultType: 'none', result: null };
  }

  if (affiliation === 'dependent') {
    const parent = {
      firstName: b.sponsorFirstName?.trim(),
      lastName:  b.sponsorLastName?.trim(),
      dob:       b.sponsorDob?.trim() || undefined,
      address:   b.sponsorAddress?.trim(),
      address2:  b.sponsorAddress2?.trim() || undefined,
      city:      b.sponsorCity?.trim(),
      state:     b.sponsorState?.trim().toUpperCase(),
      zip:       b.sponsorZip?.trim(),
    };
    console.log(`[lookup] sponsor: ${parent.firstName} ${parent.lastName} | DOB: ${parent.dob ?? 'omitted'} | ${parent.city}, ${parent.state} ${parent.zip}`);
    try {
      const result = await runDependentLookup(parent);
      console.log(`[lookup] sponsor: ${result.status?.confirmed ? 'CONFIRMED' : 'NOT CONFIRMED'} | DEA eligible: ${result.deaEligible}`);
      return { resultType: 'dependent', result };
    } catch (err) {
      console.error('[lookup] fatal error:', errMsg(err));
      return { resultType: 'error', result: { message: errMsg(err), errors: [] } };
    }
  }

  const veteran = {
    firstName: b.firstName?.trim(),
    lastName:  b.lastName?.trim(),
    dob:       b.dob?.trim() || undefined,
    address:   b.address?.trim(),
    address2:  b.address2?.trim() || undefined,
    city:      b.city?.trim(),
    state:     b.state?.trim().toUpperCase(),
    zip:       b.zip?.trim(),
  };
  console.log(`[lookup] veteran: ${veteran.firstName} ${veteran.lastName} | DOB: ${veteran.dob ?? 'omitted'} | ${veteran.city}, ${veteran.state} ${veteran.zip}`);
  try {
    const result = await runVeteranLookup(veteran);
    console.log(`[lookup] result: ${result.status?.confirmed ? 'CONFIRMED' : 'NOT CONFIRMED'}`);
    if (result.errors.length) console.log('[lookup] partial errors:', result.errors);
    return { resultType: 'veteran', result };
  } catch (err) {
    console.error('[lookup] fatal error:', errMsg(err));
    return { resultType: 'error', result: { message: errMsg(err), errors: [] } };
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  if (req.session.student) return res.redirect('/portal');
  res.render('landing');
});

app.get('/guest', (req, res) => res.render('guest', { formValues: {}, resultType: null, result: null }));

app.post('/guest/lookup', async (req, res) => {
  const { resultType, result } = await handleLookup(req.body);
  res.render('guest', { formValues: req.body, resultType, result });
});

app.get('/login', (req, res) => {
  if (req.session.student) return res.redirect('/portal');
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const name = req.body.studentName?.trim();
  const studentId = req.body.studentId?.trim() || null;
  if (!name) return res.render('login', { error: 'Please enter your name.' });
  req.session.student = { name, studentId };
  res.redirect('/portal');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

app.get('/portal', requireAuth, (req, res) => {
  const alert = req.query.sent
    ? `"${req.query.sent}" has been sent to the Veterans Services office.`
    : null;
  res.render('portal', { student: req.session.student, formValues: {}, resultType: null, result: null, alert });
});

app.post('/portal/lookup', requireAuth, async (req, res) => {
  const { resultType, result } = await handleLookup(req.body);
  res.render('portal', { student: req.session.student, formValues: req.body, resultType, result, alert: null });
});

app.post('/portal/send-letter', requireAuth, (req, res) => {
  const { icn, letterType, letterName } = req.body;
  if (!icn || !letterType) return res.status(400).send('Missing required fields');
  const entry = {
    student:    req.session.student.name,
    studentId:  req.session.student.studentId,
    icn,
    letterType,
    letterName: letterName || letterType,
    sentAt:     new Date().toISOString(),
  };
  sentLettersLog.push(entry);
  console.log(`[send-letter] ${entry.letterName} sent to VS by ${entry.student} (ICN: ${icn})`);
  res.redirect(`/portal?sent=${encodeURIComponent(entry.letterName)}`);
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.post('/letter', async (req, res) => {
  const { icn, letterType } = req.body;
  if (!icn || !letterType) return res.status(400).send('Missing ICN or letter type');
  console.log(`\n[letter] ${letterType} for ICN ${icn}`);
  try {
    const pdfResponse = await fetchLetterPdf(icn, letterType);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${letterType}.pdf"`);
    Readable.fromWeb(pdfResponse.body).pipe(res);
  } catch (err) {
    const msg = errMsg(err);
    console.error('[letter] error:', msg);
    res.status(500).send(`Letter generation failed: ${msg}`);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Veteran lookup running at http://localhost:${PORT}`));
