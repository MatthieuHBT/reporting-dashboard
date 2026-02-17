export function exportToCsv(data, columns, filename) {
  const headerRow = columns.map((c) => (c.label || c.key)).join(',')
  const rows = data.map((row) =>
    columns.map((c) => {
      const val = row[c.key]
      if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) {
        return `"${val.replace(/"/g, '""')}"`
      }
      return val ?? ''
    }).join(',')
  )
  const csv = [headerRow, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `${filename}_${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(link.href)
}
