const { runVeteranLookup } = require('./veteran');

const testVeteran = {
  firstName: 'Tamara',
  lastName:  'Ellis',
  dob:       '1967-06-19',
  address:   'BEHIND TAHINI RIVER',
  city:      'AUSTIN',
  state:     'TX',
  zip:       '78741',
  country:   'USA',
  gender:    'F',
};

async function main() {
  console.log('Running VA veteran lookup...\n');

  try {
    const result = await runVeteranLookup(testVeteran);

    console.log('=== STATUS ===');
    console.log(JSON.stringify(result.status, null, 2));

    console.log('\n=== PERMANENT & TOTAL ===');
    console.log(JSON.stringify(result.pt, null, 2));

    console.log('\n=== DISABILITY RATING ===');
    console.log(JSON.stringify(result.rating, null, 2));

    if (result.errors.length > 0) {
      console.log('\n=== ERRORS ===');
      console.log(JSON.stringify(result.errors, null, 2));
    }

  } catch (err) {
    console.error('Fatal error:', err.message);
    if (err.response) {
      console.error('Response status:', err.response.status);
      console.error('Response body:', JSON.stringify(err.response.data, null, 2));
    }
  }
}

main();