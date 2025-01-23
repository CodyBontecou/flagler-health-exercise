# Flagler Backend Exercise


## Q1a

> The query in getTableData fetches matching result by clinic_id. There are cases where we want to query by matching patient_id and sometimes matching both on clinic_id and patient_id. As our Result collection grow large, what can we do to maintain efficient data fetches?


### Compound Indexes
Allows for quick lookup of a field, but takes up more memory and slows down insert, update, and remove operations.

[Docs](https://www.mongodb.com/docs/manual/core/indexes/index-types/index-compound/)

```js
ResultSchema.index({ clinic_id: 1 }); // For queries by clinic_id
ResultSchema.index({ patient_id: 1 }); // For queries by patient_id
ResultSchema.index({ clinic_id: 1, patient_id: 1 }); // For queries by both fields
```

```js
async function getTableData(filters) {
    const query = {};
    if (filters.clinic_id) query.clinic_id = filters.clinic_id;
    if (filters.patient_id) query.patient_id = filters.patient_id;

    const dpList = await ResultModel.find(query)
        .hint({ clinic_id: 1, patient_id: 1 })
        .exec();

    return dpList.reduce((dynamicList, dp) => {
        const lastMap = dynamicList[dynamicList.length - 1];
        const isNewGroup = !lastMap || lastMap.has(dp.field_nm);

        if (isNewGroup) {
            dynamicList.push(new Map([[dp.field_nm, dp.field_value]]));
        } else {
            lastMap.set(dp.field_nm, dp.field_value);
        }
        return dynamicList;
    }, []);
}
```

This code groups records solely by field_nm uniqueness, creating new Maps whenever it encounters a field_nm that already exists in the current Map.

### Fetch only needed fields


```js
await ResultModel.find(query)
    .select('patient_id field_nm field_value') // Exclude _id and clinic_id if not needed
    .exec();
```

### Add pagination

```js
async function getTableData(filters, page = 1, limit = 100) {
    const skip = (page - 1) * limit;
    const dpList = await ResultModel.find(query)
        .skip(skip)
        .limit(limit)
        .exec();
}
```

### Data streaming

```js
async function getTableDataStream(filters) {
    const cursor = ResultModel.find(filters).cursor();
    const dynamicList = [];
    let currentPatient = null;

    for await (const doc of cursor) {
        if (!currentPatient || currentPatient.patient_id !== doc.patient_id) {
            currentPatient = { patient_id: doc.patient_id, fields: new Map() };
            dynamicList.push(currentPatient);
        }
        currentPatient.fields.set(doc.field_nm, doc.field_value);
    }
    return dynamicList;
}
```

### Caching layer

```js
const NodeCache = require('node-cache');
const resultCache = new NodeCache({ stdTTL: 600 }); // 10 minute TTL

async function getCachedTableData(filters) {
    const cacheKey = JSON.stringify(filters);
    let data = resultCache.get(cacheKey);

    if (!data) {
        data = await getTableData(filters);
        resultCache.set(cacheKey, data);
    }

    return data;
}
```

## Q1b

> What is the expected result of dynamicList? What are the expected characteristics of the result?

```js
[
  Map(2) { 'a' => '1', 'b' => '2' },  // for patient_id: 1
  Map(1) { 'a' => '3' }               // for patient_id: 3
]
```

## Q1c

> The code in is not very JS-friendly. In fact, that code was converted from an actual Java code that was used in production at an undisclosed tech unicorn 🦄. I think we can do better 😄. Let’s improve it while guaranteeing the characteristics that you identified in Q1a.

```js
// Constants
const FIELD_NAMES = ['a', 'b', 'c'];
const DEFAULT_VALUE = null;
const PATIENT_IDS = [1, 2, 3, 4, 5];

async function getTableData(filters) {
    const query = {};
    if (filters.clinic_id) query.clinic_id = filters.clinic_id;
    if (filters.patient_id) query.patient_id = filters.patient_id;

    // Get raw data from MongoDB
    const dpList = await ResultModel.find(query)
        .hint({ clinic_id: 1, patient_id: 1 })
        .exec();

    // Group by patient_id using reduce
    const patientGroups = dpList.reduce((acc, curr) => {
        acc[curr.patient_id] = {
            ...acc[curr.patient_id],
            patient_id: curr.patient_id,
            [curr.field_nm]: curr.field_value
        };
        return acc;
    }, {});

    // Create rectangular matrix with defaults
    const dynamicList = PATIENT_IDS.map(patientId => ({
        patient_id: patientId,
        ...Object.fromEntries(FIELD_NAMES.map(field => [field, DEFAULT_VALUE])),
        ...patientGroups[patientId]
    }));

    return dynamicList;
}
```

Response with pre-defined dbList:

```js
  [
    { patient_id: 1, a: '1', b: '2', c: null },
    { patient_id: 2, a: null, b: null, c: null },
    { patient_id: 3, a: '3', b: null, c: null },
    { patient_id: 4, a: null, b: null, c: null },
    { patient_id: 5, a: null, b: null, c: null }
  ]
```

## Q1d

### Current schema

```js
const ResultSchema = new mongoose.Schema({
  clinic_id: ObjectId, // This is a "foreign key" to Clinic collection
  patient_id: Number, // This is a "foreign key" to Patient collection
  field_nm: String,
  field_value: String
});
```

Pros:

- Simple structure
- Flexible for adding/removing fields

Cons:

- Multiple rows per patient
- Index size grows with number of attributes
- Requires JOIN-like operations for patient lookups

### Proposed schema

```js
// Clinic Schema
const ClinicSchema = new mongoose.Schema({
  _id: ObjectId,
  attribute_fields: [String] // ['a', 'b', 'c']
});

// Patient Schema
const PatientSchema = new mongoose.Schema({
  clinic_id: ObjectId,
  attributes: {
    type: Map,
    of: String
  },
  // Compound index on clinic_id + attributes
});
```

Pros:

- Single document per patient
- Efficient compound index for clinic-scoped queries
- Native support for dynamic fields via Map
- Reduced storage space

Cons:

- Need to update schema validation when clinic attributes change
- Map queries can be less intuitive
- Limited MongoDB Map indexing capabilities

#### Reason

The Map type in MongoDB allows storing all attributes in a single document, reducing the number of documents needed per patient from N (number of attributes) to 1.

```js
// Original: Multiple rows for one patient
{
  clinic_id: clinicA,
  patient_id: 123,
  field_nm: "a",
  field_value: "1"
}
{
  clinic_id: clinicA,
  patient_id: 123,
  field_nm: "b",
  field_value: "2"
}
{
  clinic_id: clinicA,
  patient_id: 123,
  field_nm: "c",
  field_value: "3"
}

// Proposed: Single document per patient using Map
{
  clinic_id: clinicA,
  attributes: {
    "a": "1",
    "b": "2",
    "c": "3"
  }
}
```

## Q2

> A fellow Flagler Health developer sees the following SQL query that is being used in production

```sql
SELECT
  clinicId,
  patientId,
  birthDate
FROM
  Patients
WHERE
  1=1
  AND clinicId = 123
```

> and makes a pull request to change it to

```sql
SELECT
    clinicId
  , patientId
  , birthDate
FROM
  Patients
WHERE
  clinicId = 123
```

> You did not write the original SQL statement (that developer no longer works here). You are tagged in the pull request for code review.
What is your response to your team member’s change request?

### Response

The new SQL query does the same thing as the original, just with a different style.

My response to this change would depend on the other SQL quieries within the project. Is this PR converting old SQL to the project's newly defined SQL style? Or, is it the team member's intention to alter the project's overall SQL style to this PR?

The latter case is a much larger change that should be discussed with the team and the PR should probably include all of the style choices in a single release rather than incremental changes.

## Q3a

> Implement skibidi, lowKey and yap (can be in non-JS language). You can optionally implement with different usage syntax other than the above. The requirement is that lowKey is a chainable method.


```ts
// Main wrapper function that returns an object with the chainable lowKey method
function skibidi<T>(executor: () => Promise<T>) {
  return {
    lowKey: async (errorHandler: (error: Error) => void): Promise<T | null> => {
      try {
        return await executor();
      } catch (error) {
        errorHandler(error as Error);
        return null;
      }
    }
  };
}

// Modern logging function
function yap(message: string, ...args: any[]): void {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] 💀 ${message}`, ...args);
}

// Example usage:
async function demo() {
  const userId = "123";

  const user = await skibidi(async () => {
    return await UserModel.findOne((user) => user.id === userId);
  }).lowKey((error) => {
    yap("Error finding user", error);
  });
}
```

Key features:

- skibidi: Wraps async operations with error handling
- lowKey: Chainable error handler method
- yap: Modern logging with timestamps and emojis


## Q3b

> A fellow Flagler Health developer found OSS community implementation of `skibidi`, `lowKey` , and `yap` and added the community version library to our codebase. This became our logging module for production. A new developer (aka you) joined to review this code. Upon inspection you realize that the community version is logging the error message to the local process only and currently the logs are being stored in daily batch file on local filesystem. It is fortunate that our production instance never went down because you can see all the logs from the beginning day when this logging system was implemented

You know that this logging module is expected to be deployed to multiple instances and work in distributed fashion. Describe your strategy to implement a new logging system with your teammates.


Proposed architecture:

```
[Service Instance 1] ─┐
[Service Instance 2] ─┼─→ [Log Aggregator] → [Distributed Storage] → [Search & Analysis]
[Service Instance 3] ─┘
```

Service Instances:

These are your application servers/containers running your Node.js/TypeScript application
They could be:
- EC2 instances in an Auto Scaling Group
- ECS/EKS containers
- Lambda functions
- Elastic Beanstalk environments

Log Aggregators:

Purpose: Collect, parse, and forward logs from multiple sources
- CloudWatch Logs Agent
- Datadog

Distributed Storage:
Purpose: Durably store logs with replication and retention policies
- S3
- CloudWatch

Search & Analysis:
Purpose: Query, analyze, and visualize logs
- CloudWatch Logs Insights


## Q4

> The table below shows results from an A/B test of a product feature on a continuous metric.

| **group** | **N** | **Mean** | **Standard Deviation** | **% lift (relative to control)** |
| --- | --- | --- | --- | --- |
| control | 12,000 | 7.0 | 4 |  —— |
| variant A | 12,000 | 6.7 | 3 | -4.2% |
| variant B | 12,000 | 7.1 | 6 | 1.4% |

Describe the results of the experiment and make recommendation to the team about which variant or control to use for production. Make any necessary assumptions but please state those assumptions. What the metric measures is intentionally not stated — this is one of the assumptions that you would have to make.

### Answer

Variant A shows a statistically significant decrease in the metric (-4.2%), making it clearly inferior to the control
While Variant B shows a small positive lift (1.4%), it comes with:

50% higher standard deviation than the control
A lift that is likely not statistically significant
Higher risk due to increased variance
