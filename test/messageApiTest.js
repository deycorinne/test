const csv = require("csv-parser");
const _ = require("lodash");
const fs = require("fs");
const assert = require("assert");
const request = require('superagent');
const colors = require('colors');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

const csvFile = "top50";
const messageV3Endpoint = "http://cms-dev.pbskids.org/api/messages/v3/messages.json";
const messageV2Endpoint = "https://pbskids.org/kidsactivity/messages/v2/messages.json";

let oldMessages = [];
let newMessages = [];
let rows = 0;
let records = [];

const csvWriter = createCsvWriter({
  path: __dirname + `/resources/${csvFile}results.csv`,
  header: [
      {id: 'query', title: 'QUERY'},
      {id: 'v2', title: 'V2 RESULT'},
      {id: 'v3', title: 'V3 RESULT'},
      {id: 'match', title: 'V2 == V3?'}
  ]
});

const getAndSaveMessages = async (endpoint, query, version) => {
  return new Promise((resolve, reject) => {
    request
      .get(endpoint + query)
      .timeout(6000000)
      .then(response => {
        if (response.status == 200){
          // console.log(colors.green( version + ' Sucessfully requested: ' + query));
          resolve(response.body.messages);
        }
      })
      .catch(err => {
        console.log(colors.red.underline(version + ' Error Message: ' + err.message));
        resolve(null);
      })
   });
}

// Read the queries requested from the CSV file and save to array
const getQueries = async () => {
  let queries = [];
  return new Promise((resolve, reject) => {
    fs.createReadStream(__dirname + `/resources/${csvFile}.csv`)
    .pipe(csv())
    .on("data", row => {
      let query = row.request.replace("/kidsactivity/messages/v2/messages.json", "");
      queries.push(query);
      console.log(colors.brightCyan(query));
    })
    .on("end", () => {
      // split queries into 50 groups
      queries = _.chunk(queries, 50);
      console.log("CSV file successfully processed.");
      return resolve(queries);
    })
  });
}

// loop through all saved queries from above and make requests
const requestEndpoints = async () => {
  const allQueries = await getQueries();

  return Promise.all(
    allQueries.map(async queryGroup => {
      return Promise.all(
        queryGroup.map(async query => {
          const oldMsg = await getAndSaveMessages(messageV2Endpoint, query, "V2");
          records.push({'query': query, 'v2': JSON.stringify(oldMsg[0])});
        })
      ).then( values => {
        return Promise.all(
          queryGroup.map(async query => {
            const newMsg = await getAndSaveMessages(messageV3Endpoint, query, "V3");
            idx = _.findIndex(records, { 'query': query });
            records[idx].v3 = JSON.stringify(newMsg[0]);
          })
        );
      });
    })
  );
}

describe("Test Message API Requests", function() {
  this.timeout(100000000000000); // something insane bc there are a ton of requests

  // before we run the tests, make all the requests!
  before(async () => {
    return await requestEndpoints();
  });

  describe("Compare V2 and V3 Message API Requests", function() {

    it('Should have matching result lengths for both requests', () => {
      assert.equal(oldMessages.length, rows);
      assert.equal(newMessages.length, rows);
      assert.equal(oldMessages.length, newMessages.length);
    });

    it('Should have matching content for each request', () => {
      records.forEach((record) => {
        assert(record.v3);
        assert(record.v2);
        assert.equal(record.v3.slug, record.v2.slug);
        assert.equal(record.v3.title, record.v2.title);
        assert.equal(record.v3.type, record.v2.type);
        assert.equal(record.v3.subtype, record.v2.subtype);
        assert.equal(record.v3.long_description, record.v2.long_description);
        assert.equal(record.v3.short_description, record.v2.short_description);
        assert.equal(record.v3.content, record.v2.content);
        assert.equal(record.v3.action_text, record.v2.action_text);
        record.match = true;
      });
    });

  });

  after(async () => {
    csvWriter.writeRecords(records)
    .then(() => {
        console.log('...Done writing to result file');
    });
  })
});
