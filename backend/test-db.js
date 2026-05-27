const pool = require('./db');

async function testDB() {

  try {

    const result = await pool.query(
      'SELECT * FROM devices'
    );

    console.log(result.rows);

  } catch (error) {

    console.error(error);

  }

}

testDB();