use calamine::{open_workbook_auto, Data, Reader};
use quick_xml::{events::Event, Reader as XmlReader};
use rfd::FileDialog;
use rust_xlsxwriter::{Color, Format, FormatAlign, Workbook};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::{
    fs::File,
    io::Read,
    path::{Path, PathBuf},
};
use zip::ZipArchive;

const MAX_IMPORTED_CELLS: usize = 100_000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpreadsheetWorkbookInput {
    pub name: String,
    pub sheets: Vec<SpreadsheetSheetInput>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpreadsheetSheetInput {
    pub name: String,
    pub cells: HashMap<String, SpreadsheetCellInput>,
    pub column_widths: HashMap<String, f64>,
    pub row_heights: HashMap<u32, f64>,
    pub frozen_rows: u32,
    pub frozen_columns: u16,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpreadsheetCellInput {
    pub value: serde_json::Value,
    pub formula: Option<String>,
    pub style: Option<CellStyleInput>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellStyleInput {
    pub bold: Option<bool>,
    pub italic: Option<bool>,
    pub foreground: Option<String>,
    pub background: Option<String>,
    pub horizontal_align: Option<String>,
    pub number_format: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct XlsxCompatibilityReport {
    pub path: String,
    pub imported_cells: usize,
    pub exported_cells: usize,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct XlsxImportResult {
    pub workbook: serde_json::Value,
    pub report: XlsxCompatibilityReport,
}

#[derive(Default)]
struct ImportedSheetLayout {
    column_widths: HashMap<String, f64>,
    row_heights: HashMap<u32, f64>,
    frozen_rows: u32,
    frozen_columns: u16,
}

pub fn pick_xlsx_for_import() -> Option<PathBuf> {
    FileDialog::new()
        .set_title("Import XLSX workbook")
        .add_filter("Excel workbook", &["xlsx"])
        .pick_file()
}

pub fn pick_xlsx_for_export(default_name: &str) -> Option<PathBuf> {
    FileDialog::new()
        .set_title("Export XLSX workbook")
        .add_filter("Excel workbook", &["xlsx"])
        .set_file_name(format!("{}.xlsx", safe_file_name(default_name)))
        .save_file()
}

pub fn import_xlsx(path: &Path) -> Result<XlsxImportResult, String> {
    let mut source = open_workbook_auto(path).map_err(|error| error.to_string())?;
    let names = source.sheet_names().to_vec();
    if names.is_empty() {
        return Err("The workbook does not contain a worksheet.".to_string());
    }

    let mut sheets = Vec::with_capacity(names.len());
    let mut warnings = Vec::new();
    let mut imported_cells = 0usize;
    for (sheet_index, name) in names.iter().enumerate() {
        let range = source
            .worksheet_range(name)
            .map_err(|error| format!("Could not read {name}: {error}"))?;
        let formulas = source.worksheet_formula(name).ok();
        let mut cells = serde_json::Map::new();
        let (height, width) = range.get_size();
        let (start_row, start_column) = range.start().unwrap_or((0, 0));
        for row in start_row..start_row + height as u32 {
            for column in start_column..start_column + width as u32 {
                let value = range.get_value((row, column)).unwrap_or(&Data::Empty);
                let formula = formulas
                    .as_ref()
                    .and_then(|formula_range| formula_range.get_value((row, column)))
                    .filter(|formula| !formula.is_empty())
                    .cloned();
                if matches!(value, Data::Empty) && formula.is_none() {
                    continue;
                }
                imported_cells += 1;
                if imported_cells > MAX_IMPORTED_CELLS {
                    return Err(format!("This workbook exceeds the {MAX_IMPORTED_CELLS} non-empty cell import limit."));
                }
                let address = cell_address(column as usize, row as usize);
                cells.insert(
                    address.clone(),
                    serde_json::json!({
                        "address": address,
                        "value": calamine_value(value),
                        "formula": formula,
                    }),
                );
            }
        }
        let layout = match import_sheet_layout(path, sheet_index + 1) {
            Ok(layout) => layout,
            Err(error) => {
                warnings.push(format!("Could not read layout for {name}: {error}"));
                ImportedSheetLayout::default()
            }
        };
        sheets.push(serde_json::json!({
            "id": format!("sheet-{}", sheet_index + 1),
            "name": name,
            "cells": cells,
            "columnWidths": layout.column_widths,
            "rowHeights": layout.row_heights,
            "rowCount": (start_row as usize + height).max(100),
            "columnCount": (start_column as usize + width).max(26),
            "frozenRows": layout.frozen_rows,
            "frozenColumns": layout.frozen_columns,
        }));
    }

    let workbook_name = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Imported workbook")
        .to_string();
    let report = XlsxCompatibilityReport {
        path: path.display().to_string(),
        imported_cells,
        exported_cells: 0,
        warnings: {
            warnings.push("Imported values, formulas, row/column dimensions, and frozen panes. Cell styles, merged cells, charts, drawings, macros, tables, data validation, conditional formatting, and opaque OOXML parts are not preserved yet.".to_string());
            warnings
        },
    };
    Ok(XlsxImportResult {
        workbook: serde_json::json!({
            "id": "workbook-1",
            "name": workbook_name,
            "activeSheetId": "sheet-1",
            "version": 1,
            "sheets": sheets,
        }),
        report,
    })
}

fn import_sheet_layout(path: &Path, sheet_index: usize) -> Result<ImportedSheetLayout, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|error| error.to_string())?;
    let mut entry = archive
        .by_name(&format!("xl/worksheets/sheet{sheet_index}.xml"))
        .map_err(|error| error.to_string())?;
    let mut xml = String::new();
    entry
        .read_to_string(&mut xml)
        .map_err(|error| error.to_string())?;
    let mut reader = XmlReader::from_str(&xml);
    reader.config_mut().trim_text(true);
    let mut layout = ImportedSheetLayout::default();
    let mut buffer = Vec::new();
    loop {
        match reader
            .read_event_into(&mut buffer)
            .map_err(|error| error.to_string())?
        {
            Event::Start(event) | Event::Empty(event) => match event.name().as_ref() {
                b"col" => {
                    let mut min = None;
                    let mut max = None;
                    let mut width = None;
                    for attribute in event.attributes().flatten() {
                        match attribute.key.as_ref() {
                            b"min" => min = parse_xml_u32(&attribute.value),
                            b"max" => max = parse_xml_u32(&attribute.value),
                            b"width" => width = parse_xml_f64(&attribute.value),
                            _ => {}
                        }
                    }
                    if let (Some(min), Some(max), Some(width)) = (min, max, width) {
                        for index in min..=max {
                            if index > 0 {
                                layout.column_widths.insert(
                                    column_label(index as usize - 1),
                                    normalize_xlsx_column_width(width),
                                );
                            }
                        }
                    }
                }
                b"row" => {
                    let mut number = None;
                    let mut height = None;
                    for attribute in event.attributes().flatten() {
                        match attribute.key.as_ref() {
                            b"r" => number = parse_xml_u32(&attribute.value),
                            b"ht" => height = parse_xml_f64(&attribute.value),
                            _ => {}
                        }
                    }
                    if let (Some(number), Some(height)) = (number, height) {
                        layout
                            .row_heights
                            .insert(number, normalize_xlsx_row_height(height));
                    }
                }
                b"pane" => {
                    for attribute in event.attributes().flatten() {
                        match attribute.key.as_ref() {
                            b"xSplit" => {
                                layout.frozen_columns =
                                    parse_xml_u32(&attribute.value).unwrap_or(0) as u16
                            }
                            b"ySplit" => {
                                layout.frozen_rows = parse_xml_u32(&attribute.value).unwrap_or(0)
                            }
                            _ => {}
                        }
                    }
                }
                _ => {}
            },
            Event::Eof => break,
            _ => {}
        }
        buffer.clear();
    }
    Ok(layout)
}

fn parse_xml_u32(value: &[u8]) -> Option<u32> {
    std::str::from_utf8(value).ok()?.parse().ok()
}

fn parse_xml_f64(value: &[u8]) -> Option<f64> {
    std::str::from_utf8(value).ok()?.parse().ok()
}

// Excel stores a font-dependent padding allowance in worksheet XML widths.
// rust_xlsxwriter follows that convention (`18` becomes `18.7109375`), while
// the Office IDE grid stores the user-facing width. Normalize it for a stable
// export → import round trip.
fn normalize_xlsx_column_width(width: f64) -> f64 {
    const EXCEL_PADDING: f64 = 0.710_937_5;
    if width >= 1.0 {
        ((width - EXCEL_PADDING) * 256.0).round() / 256.0
    } else {
        width
    }
}

// rust_xlsxwriter serializes its point-based UI height with a quarter-point
// adjustment, so restore the UI-facing value on import just as we do widths.
fn normalize_xlsx_row_height(height: f64) -> f64 {
    ((height + 0.25) * 100.0).round() / 100.0
}

fn column_label(mut index: usize) -> String {
    let mut label = String::new();
    loop {
        label.insert(0, (b'A' + (index % 26) as u8) as char);
        if index < 26 {
            return label;
        }
        index = index / 26 - 1;
    }
}

pub fn export_xlsx(
    path: &Path,
    source: SpreadsheetWorkbookInput,
) -> Result<XlsxCompatibilityReport, String> {
    if source.sheets.is_empty() {
        return Err("Cannot export a workbook without worksheets.".to_string());
    }
    let mut workbook = Workbook::new();
    let mut exported_cells = 0usize;
    for sheet in &source.sheets {
        let worksheet = workbook.add_worksheet();
        worksheet
            .set_name(&sheet.name)
            .map_err(|error| error.to_string())?;
        worksheet
            .set_freeze_panes(sheet.frozen_rows, sheet.frozen_columns)
            .map_err(|error| error.to_string())?;
        for (column, width) in &sheet.column_widths {
            if let Some(index) = column_index(column) {
                worksheet
                    .set_column_width(index, *width)
                    .map_err(|error| error.to_string())?;
            }
        }
        for (row, height) in &sheet.row_heights {
            if *row > 0 {
                worksheet
                    .set_row_height(row - 1, *height)
                    .map_err(|error| error.to_string())?;
            }
        }
        for (address, cell) in &sheet.cells {
            let Some((row, column)) = parse_address(address) else {
                continue;
            };
            exported_cells += 1;
            let format = cell
                .style
                .as_ref()
                .map(xlsx_format)
                .transpose()
                .map_err(|error| error.to_string())?;
            if let Some(formula) = &cell.formula {
                let formula = if formula.starts_with('=') {
                    formula.as_str()
                } else {
                    &format!("={formula}")
                };
                if let Some(format) = &format {
                    worksheet
                        .write_formula_with_format(row, column, formula, format)
                        .map_err(|error| error.to_string())?;
                } else {
                    worksheet
                        .write_formula(row, column, formula)
                        .map_err(|error| error.to_string())?;
                }
            } else if let Some(format) = &format {
                write_json_value(worksheet, row, column, &cell.value, Some(format))?;
            } else {
                write_json_value(worksheet, row, column, &cell.value, None)?;
            }
        }
    }
    workbook.save(path).map_err(|error| error.to_string())?;
    Ok(XlsxCompatibilityReport {
        path: path.display().to_string(),
        imported_cells: 0,
        exported_cells,
        warnings: vec![
            "Exported values, formulas, basic cell styles, row/column dimensions, and frozen panes. Merged cells, charts, drawings, macros, tables, data validation, conditional formatting, and opaque OOXML parts are not represented by the current IR.".to_string(),
        ],
    })
}

fn write_json_value(
    worksheet: &mut rust_xlsxwriter::Worksheet,
    row: u32,
    column: u16,
    value: &serde_json::Value,
    format: Option<&Format>,
) -> Result<(), String> {
    match value {
        serde_json::Value::Null => Ok(()),
        serde_json::Value::Bool(value) => match format {
            Some(format) => worksheet
                .write_boolean_with_format(row, column, *value, format)
                .map(|_| ())
                .map_err(|error| error.to_string()),
            None => worksheet
                .write_boolean(row, column, *value)
                .map(|_| ())
                .map_err(|error| error.to_string()),
        },
        serde_json::Value::Number(value) => {
            let number = value
                .as_f64()
                .ok_or_else(|| "Cell number is outside XLSX range.".to_string())?;
            match format {
                Some(format) => worksheet
                    .write_number_with_format(row, column, number, format)
                    .map(|_| ())
                    .map_err(|error| error.to_string()),
                None => worksheet
                    .write_number(row, column, number)
                    .map(|_| ())
                    .map_err(|error| error.to_string()),
            }
        }
        serde_json::Value::String(value) => match format {
            Some(format) => worksheet
                .write_string_with_format(row, column, value, format)
                .map(|_| ())
                .map_err(|error| error.to_string()),
            None => worksheet
                .write_string(row, column, value)
                .map(|_| ())
                .map_err(|error| error.to_string()),
        },
        _ => Err("Cell values must be null, boolean, number, or string.".to_string()),
    }
}

fn xlsx_format(style: &CellStyleInput) -> Result<Format, String> {
    let mut format = Format::new();
    if style.bold.unwrap_or(false) {
        format = format.set_bold();
    }
    if style.italic.unwrap_or(false) {
        format = format.set_italic();
    }
    if let Some(color) = &style.foreground {
        format = format.set_font_color(parse_color(color)?);
    }
    if let Some(color) = &style.background {
        format = format.set_background_color(parse_color(color)?);
    }
    if let Some(number_format) = &style.number_format {
        format = format.set_num_format(number_format);
    }
    if let Some(alignment) = &style.horizontal_align {
        format = format.set_align(match alignment.as_str() {
            "left" => FormatAlign::Left,
            "center" => FormatAlign::Center,
            "right" => FormatAlign::Right,
            _ => return Err(format!("Unsupported horizontal alignment: {alignment}")),
        });
    }
    Ok(format)
}

fn parse_color(value: &str) -> Result<Color, String> {
    let hex = value.trim_start_matches('#');
    if hex.len() != 6 || !hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(format!("Invalid RGB color: {value}"));
    }
    u32::from_str_radix(hex, 16)
        .map(Color::RGB)
        .map_err(|_| format!("Invalid RGB color: {value}"))
}

fn calamine_value(value: &Data) -> serde_json::Value {
    match value {
        Data::Empty => serde_json::Value::Null,
        Data::String(value) => serde_json::Value::String(value.clone()),
        Data::Float(value) => serde_json::json!(value),
        Data::Int(value) => serde_json::json!(value),
        Data::Bool(value) => serde_json::json!(value),
        Data::DateTime(value) => serde_json::json!(value.as_f64()),
        Data::DateTimeIso(value) | Data::DurationIso(value) => serde_json::json!(value),
        Data::Error(value) => serde_json::json!(format!("#{value}")),
    }
}

fn cell_address(column: usize, row: usize) -> String {
    let mut column = column + 1;
    let mut label = String::new();
    while column > 0 {
        column -= 1;
        label.insert(0, char::from(b'A' + (column % 26) as u8));
        column /= 26;
    }
    format!("{}{}", label, row + 1)
}

fn column_index(label: &str) -> Option<u16> {
    let value = label.bytes().try_fold(0u32, |index, byte| {
        if !byte.is_ascii_uppercase() {
            return None;
        }
        index.checked_mul(26)?.checked_add((byte - b'A' + 1) as u32)
    })?;
    value.checked_sub(1)?.try_into().ok()
}

fn parse_address(address: &str) -> Option<(u32, u16)> {
    let split = address.find(|character: char| character.is_ascii_digit())?;
    let column = column_index(&address[..split])?;
    let row = address[split..].parse::<u32>().ok()?.checked_sub(1)?;
    Some((row, column))
}

fn safe_file_name(value: &str) -> String {
    let clean: String = value
        .chars()
        .map(|character| {
            if "<>:\\|?*/\"".contains(character) {
                '_'
            } else {
                character
            }
        })
        .collect();
    if clean.trim().is_empty() {
        "Workbook".to_string()
    } else {
        clean
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn translates_excel_addresses() {
        assert_eq!(cell_address(0, 0), "A1");
        assert_eq!(cell_address(26, 4), "AA5");
        assert_eq!(parse_address("AA5"), Some((4, 26)));
        assert_eq!(parse_address("A0"), None);
    }

    #[test]
    fn normalizes_excel_column_width_padding() {
        assert_eq!(normalize_xlsx_column_width(18.710_937_5), 18.0);
    }

    #[test]
    fn normalizes_excel_row_height_padding() {
        assert_eq!(normalize_xlsx_row_height(24.75), 25.0);
    }

    #[test]
    fn exports_and_imports_values_and_formulas() {
        let path = std::env::temp_dir().join(format!(
            "office-ide-xlsx-test-{}.xlsx",
            uuid::Uuid::new_v4()
        ));
        let workbook: SpreadsheetWorkbookInput = serde_json::from_value(serde_json::json!({
            "name": "Round trip",
            "sheets": [{
                "name": "Data",
                "cells": {
                    "A1": { "value": "Revenue", "style": { "bold": true, "background": "#254F7D" } },
                    "B2": { "value": 42 },
                    "C2": { "value": null, "formula": "B2*2" }
                },
                "columnWidths": { "A": 18 },
                "rowHeights": { "1": 25 },
                "frozenRows": 1,
                "frozenColumns": 0
            }]
        })).unwrap();
        let report = export_xlsx(&path, workbook).unwrap();
        assert_eq!(report.exported_cells, 3);
        let result = import_xlsx(&path).unwrap();
        assert_eq!(result.report.imported_cells, 3);
        assert_eq!(
            result.workbook["sheets"][0]["cells"]["A1"]["value"],
            "Revenue"
        );
        assert_eq!(result.workbook["sheets"][0]["cells"]["B2"]["value"], 42.0);
        assert_eq!(
            result.workbook["sheets"][0]["cells"]["C2"]["formula"],
            "B2*2"
        );
        assert_eq!(result.workbook["sheets"][0]["columnWidths"]["A"], 18.0);
        assert_eq!(result.workbook["sheets"][0]["rowHeights"]["1"], 25.0);
        assert_eq!(result.workbook["sheets"][0]["frozenRows"], 1);
        assert_eq!(result.workbook["sheets"][0]["frozenColumns"], 0);
        let _ = std::fs::remove_file(path);
    }
}
