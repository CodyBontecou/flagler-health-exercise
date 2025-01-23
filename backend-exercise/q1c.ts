const FIELD_NAMES = ['a', 'b', 'c']
const DEFAULT_VALUE = null
const PATIENT_IDS = [1, 2, 3, 4, 5]

async function getTableData(filters) {
    const query = {}
    if (filters.clinic_id) query.clinic_id = filters.clinic_id
    if (filters.patient_id) query.patient_id = filters.patient_id

    // Get raw data from MongoDB
    // const dpList = await ResultModel.find(query)
    //     .hint({ clinic_id: 1, patient_id: 1 })
    //     .exec()
    const dpList = [
        { patient_id: 1, field_nm: 'a', field_value: '1', clinic_id: 1 },
        { patient_id: 1, field_nm: 'b', field_value: '2', clinic_id: 1 },
        { patient_id: 3, field_nm: 'a', field_value: '3', clinic_id: 1 },
    ]

    // Group by patient_id using reduce
    const patientGroups = dpList.reduce((acc, curr) => {
        acc[curr.patient_id] = {
            ...acc[curr.patient_id],
            patient_id: curr.patient_id,
            [curr.field_nm]: curr.field_value,
        }
        return acc
    }, {})

    // Create rectangular matrix with defaults
    const dynamicList = PATIENT_IDS.map(patientId => ({
        patient_id: patientId,
        ...Object.fromEntries(FIELD_NAMES.map(field => [field, DEFAULT_VALUE])),
        ...patientGroups[patientId],
    }))

    return dynamicList
}

console.log(getTableData({ clinic_id: 1 }))
