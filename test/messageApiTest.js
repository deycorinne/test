const csv = require("csv-parser");
const fs = require("fs");
const assert = require("assert");
const request = require('superagent');

const messageV3Endpoint = "http://cms-dev.pbskids.org/api/messages/v3/messages.json";
const messageV2Endpoint = "https://pbskids.org/kidsactivity/messages/v2/messages.json";

let oldMessages = [];
let newMessages = [];
let rows = 0;


const getAndSaveMessages = async (endpoint, query, version) => {
  return new Promise((resolve, reject) => {
    request
      .get(endpoint + query)
      .timeout(6000000)
      .then(response => {
        if (response.status == 200){
          // console.log( version + ' Sucessfully requested: ' + query);
          resolve(response.body.messages);
        }
      })
      .catch(err => {
        console.log(version + ' Error Message: ' + err.message);
        resolve(null);
      })
   });
}

// Read the queries requested from the CSV file and save to array
const getQueries = async () => {
  let queries = [];
  return new Promise((resolve, reject) => {
    fs.createReadStream(__dirname + "/resources/801-1600.csv")
    .pipe(csv())
    .on("data", row => {
      rows++;
      let query = row.request.replace("/kidsactivity/messages/v2/messages.json", "");
      queries.push(query);
    })
    .on("end", () => {
      console.log("CSV file successfully processed.");
      return resolve(queries);
    })
  });
}

// loop through all saved queries from above and make requests
const requestEndpoints = async () => {
  const queries = await getQueries();

  return Promise.all(
    queries.map(async query => {
      const oldMsg = await getAndSaveMessages(messageV2Endpoint, query, "V2");
      oldMessages.push(oldMsg);

      const newMsg = await getAndSaveMessages(messageV3Endpoint, query, "V2");
      newMessages.push(newMsg);
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
      newMessages.forEach((message, idx) => {
        assert.equal(message.slug, oldMessages[idx].slug);
        assert.equal(message.title, oldMessages[idx].title);
        assert.equal(message.type, oldMessages[idx].type);
        assert.equal(message.subtype, oldMessages[idx].subtype);
        assert.equal(message.long_description, oldMessages[idx].long_description);
        assert.equal(message.short_description, oldMessages[idx].short_description);
        assert.equal(message.content, oldMessages[idx].content);
        assert.equal(message.action_text, oldMessages[idx].action_text);
      });
    });

  });
});
