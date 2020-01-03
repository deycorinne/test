const _ = require("lodash");
const assert = require("assert");
const colors = require("colors");
const csv = require("csv-parser");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;
const fs = require("fs");
const request = require("superagent");

const csvFile = "7201-end";
const messageV3Endpoint =
    "http://cms-dev.pbskids.org/api/messages/v3/messages.json";
const messageV2Endpoint =
    "https://pbskids.org/kidsactivity/messages/v2/messages.json";

let oldMessages = [];
let newMessages = [];
let rows = 0;
let responseRecords = [];
let missingMessages = [];

const csvResultWriter = createCsvWriter({
    path: __dirname + `/resources/${csvFile}results.csv`,
    header: [
        { id: "query", title: "QUERY" },
        { id: "v2", title: "V2 RESULT" },
        { id: "v3", title: "V3 RESULT" },
        { id: "match", title: "V2 == V3?" }
    ]
});

const csvMissingMessageWriter = createCsvWriter({
    path: __dirname + `/resources/missingMessages.csv`,
    header: [
        { id: "show", title: "show" },
        { id: "type", title: "type" },
        { id: "subtype", title: "subtype" },
        { id: "long_description", title: "long_description" },
        { id: "short_description", title: "short_description" },
        { id: "content", title: "content" },
        { id: "action_text", title: "action_text" }
    ]
});

const getAndSaveMessages = async (endpoint, query, version) => {
    return new Promise((resolve, reject) => {
        request
            .get(endpoint + query)
            .timeout(6000000)
            .then(response => {
                if (response.status == 200) {
                    console.log(
                        colors.green(
                            version + " Sucessfully requested: " + query
                        )
                    );
                    let msgObj = response.body.messages[0];
                    console.log(response.body.content.title);
                    if (!_.isEmpty(msgObj)){
                      msgObj["show"] = response.body.content.title;
                    }

                    resolve(msgObj);
                }
            })
            .catch(err => {
                console.log(
                    colors.red.underline(
                        version + " Error Message: " + err.message
                    )
                );
                resolve(null);
            });
    });
};

const getMissingMessages = async () => {
  return new Promise((resolve, reject) => {
    fs.createReadStream(__dirname + `/resources/missingMessages.csv`)
        .pipe(csv())
        .on("data", row => {
          // console.log(colors.brightCyan(row));
          missingMessages.push(row);
        })
        .on("end", () => {
          // split queries into 50 groups
          console.log("CSV file successfully processed.");
          return resolve(missingMessages);
        });
  });
}
// Read the queries requested from the CSV file and save to array
const getQueries = async () => {
    let queries = [];
    return new Promise((resolve, reject) => {
        fs.createReadStream(__dirname + `/resources/${csvFile}.csv`)
            .pipe(csv())
            .on("data", row => {
                let query = row.request.replace(
                    "/kidsactivity/messages/v2/messages.json",
                    ""
                );
                queries.push(query);
                console.log(colors.brightCyan(query));
            })
            .on("end", () => {
                // split queries into 50 groups
                queries = _.chunk(queries, 50);
                console.log("CSV file successfully processed.");
                return resolve(queries);
            });
    });
};

// loop through all saved queries from above and make requests
const requestEndpoints = async () => {
    const allQueries = await getQueries();
    missingMessages = await getMissingMessages();

    return Promise.all(
        allQueries.map(async queryGroup => {
            return Promise.all(
                queryGroup.map(async query => {
                    const oldMsg = await getAndSaveMessages(
                        messageV2Endpoint,
                        query,
                        "V2"
                    );

                    if (!_.isEmpty(oldMsg)) {
                        responseRecords.push({
                            query: query,
                            v2: JSON.stringify(oldMsg)
                        });
                        // check to see if we already have this message in the array, if not add it
                        if (
                            !_.find(missingMessages, function(msg) {
                              return (
                                  msg.long_description.trim() ==
                                  oldMsg.long_description.trim()
                              )})
                        ) {
                            missingMessages.push(oldMsg);
                        }
                    }
                })
            ).then(values => {
                return Promise.all(
                    queryGroup.map(async query => {
                        const newMsg = await getAndSaveMessages(
                            messageV3Endpoint,
                            query,
                            "V3"
                        );
                        idx = _.findIndex(responseRecords, { query: query });
                        if (!_.isEmpty(newMsg)) {
                            responseRecords[idx].v3 = JSON.stringify(newMsg[0]);
                            // check to see if the message returned is listed in missing messages, if so, remove it
                            _.remove(missingMessages, function(msg) {
                                return (
                                    msg.long_description.trim() ==
                                    newMsg.long_description.trim()
                                );
                            });
                        }
                    })
                );
            });
        })
    );
};

describe("Test Message API Requests", function() {
    this.timeout(100000000000000); // something insane bc there are a ton of requests

    // before we run the tests, make all the requests!
    before(async () => {
        return await requestEndpoints();
    });

    describe("Compare V2 and V3 Message API Requests", function() {
        it("Should have matching result lengths for both requests", () => {
            assert.equal(oldMessages.length, rows);
            assert.equal(newMessages.length, rows);
            assert.equal(oldMessages.length, newMessages.length);
        });

        it("Should have matching content for each request", () => {
            responseRecords.forEach(record => {
                assert(record.v2);
                missingMessages.push(record.v2);
                assert(record.v3);
                assert.equal(record.v3.slug, record.v2.slug);
                assert.equal(record.v3.title, record.v2.title);
                assert.equal(record.v3.type, record.v2.type);
                assert.equal(record.v3.subtype, record.v2.subtype);
                assert.equal(
                    record.v3.long_description,
                    record.v2.long_description
                );
                assert.equal(
                    record.v3.short_description,
                    record.v2.short_description
                );
                assert.equal(record.v3.content, record.v2.content);
                assert.equal(record.v3.action_text, record.v2.action_text);
                record.match = true;
            });
        });
    });

    after(async () => {
        csvResultWriter.writeRecords(responseRecords).then(() => {
            console.log("...Done writing to result file");
        });

        csvMissingMessageWriter.writeRecords(missingMessages).then(() => {
            console.log("...Done writing to missing messages file");
        });
    });
});
