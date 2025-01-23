const dpList = [
    { patient_id: 1, field_nm: 'a', field_value: '1', clinic_id: 1 },
    { patient_id: 1, field_nm: 'b', field_value: '2', clinic_id: 1 },
    { patient_id: 3, field_nm: 'a', field_value: '3', clinic_id: 1 },
]

const dynamicList = []
let rowMap
let prevRowId = -1
for (const dp of dpList) {
    if (dp.patient_id !== prevRowId) {
        rowMap = new Map()
        dynamicList.push(rowMap)
    }
    prevRowId = dp.patient_id

    rowMap.set(dp.field_nm, dp.field_value)
}

console.log(dynamicList)
