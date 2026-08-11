use quick_xml::{events::Event, Reader};
use rfd::FileDialog;
use std::{
    fs::File,
    io::{Read, Write},
    path::Path,
};
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

pub fn pick_docx_for_import() -> Option<std::path::PathBuf> {
    FileDialog::new()
        .add_filter("Word document", &["docx"])
        .pick_file()
}

pub fn pick_docx_for_export() -> Option<std::path::PathBuf> {
    FileDialog::new()
        .add_filter("Word document", &["docx"])
        .set_file_name("report.docx")
        .save_file()
}

pub fn export_docx(path: &Path, source: &str) -> Result<(), String> {
    let file = File::create(path).map_err(|error| error.to_string())?;
    let mut archive = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    write_entry(&mut archive, "[Content_Types].xml", CONTENT_TYPES, options)?;
    write_entry(&mut archive, "_rels/.rels", ROOT_RELS, options)?;
    write_entry(
        &mut archive,
        "word/_rels/document.xml.rels",
        DOCUMENT_RELS,
        options,
    )?;
    write_entry(
        &mut archive,
        "word/document.xml",
        &document_xml(source),
        options,
    )?;
    archive.finish().map_err(|error| error.to_string())?;
    Ok(())
}

pub fn import_docx(path: &Path) -> Result<String, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|error| error.to_string())?;
    let mut document = archive
        .by_name("word/document.xml")
        .map_err(|error| error.to_string())?;
    let mut xml = String::new();
    document
        .read_to_string(&mut xml)
        .map_err(|error| error.to_string())?;
    document_xml_to_djot(&xml)
}

fn write_entry<W: Write + std::io::Seek>(
    archive: &mut ZipWriter<W>,
    name: &str,
    contents: &str,
    options: SimpleFileOptions,
) -> Result<(), String> {
    archive
        .start_file(name, options)
        .map_err(|error| error.to_string())?;
    archive
        .write_all(contents.as_bytes())
        .map_err(|error| error.to_string())
}

fn document_xml(source: &str) -> String {
    let mut body = String::new();
    let lines: Vec<&str> = source.lines().collect();
    let mut index = 0;
    while index < lines.len() {
        let line = lines[index].trim();
        if line.is_empty() {
            index += 1;
            continue;
        }
        if line.starts_with('|') {
            let mut rows = Vec::new();
            while index < lines.len() && lines[index].trim_start().starts_with('|') {
                let cells = lines[index]
                    .trim()
                    .trim_matches('|')
                    .split('|')
                    .map(str::trim)
                    .collect::<Vec<_>>();
                if !cells
                    .iter()
                    .all(|value| value.chars().all(|ch| ch == '-' || ch == ':'))
                {
                    rows.push(cells);
                }
                index += 1;
            }
            if !rows.is_empty() {
                body.push_str(&table_xml(&rows));
            }
            continue;
        }
        let (style, text) = if let Some(text) = line.strip_prefix("# ") {
            (Some("Heading1"), text)
        } else if let Some(text) = line.strip_prefix("## ") {
            (Some("Heading2"), text)
        } else if let Some(text) = line.strip_prefix("1. ") {
            (Some("ListParagraph"), text)
        } else {
            (None, line)
        };
        body.push_str(&paragraph_xml(text, style));
        index += 1;
    }
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>{body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>"#
    )
}

fn paragraph_xml(text: &str, style: Option<&str>) -> String {
    let properties = style
        .map(|style| format!(r#"<w:pPr><w:pStyle w:val="{style}"/></w:pPr>"#))
        .unwrap_or_default();
    format!(
        r#"<w:p>{properties}<w:r><w:t xml:space="preserve">{}</w:t></w:r></w:p>"#,
        escape_xml(text)
    )
}

fn table_xml(rows: &[Vec<&str>]) -> String {
    let rows = rows
        .iter()
        .map(|row| {
            format!(
                "<w:tr>{}</w:tr>",
                row.iter()
                    .map(|cell| format!(
                        r#"<w:tc><w:tcPr><w:tcW w:w="3120" w:type="dxa"/></w:tcPr>{}</w:tc>"#,
                        paragraph_xml(cell, None)
                    ))
                    .collect::<String>()
            )
        })
        .collect::<String>();
    format!(
        r#"<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr>{rows}</w:tbl>"#
    )
}

fn document_xml_to_djot(xml: &str) -> Result<String, String> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut buffer = Vec::new();
    let mut output = Vec::new();
    let mut paragraph = String::new();
    let mut style = None::<String>;
    let mut in_paragraph = false;
    let mut in_table = false;
    let mut current_cell = None::<String>;
    let mut current_row = Vec::<String>::new();
    let mut table_rows = Vec::<Vec<String>>::new();
    loop {
        match reader
            .read_event_into(&mut buffer)
            .map_err(|error| error.to_string())?
        {
            Event::Start(event) => match event.name().as_ref() {
                b"w:p" => {
                    in_paragraph = true;
                    paragraph.clear();
                    style = None;
                }
                b"w:tbl" => {
                    in_table = true;
                    table_rows.clear();
                }
                b"w:tr" => current_row.clear(),
                b"w:tc" => current_cell = Some(String::new()),
                b"w:pStyle" => {
                    style = event
                        .attributes()
                        .flatten()
                        .find(|attribute| attribute.key.as_ref() == b"w:val")
                        .and_then(|attribute| String::from_utf8(attribute.value.into_owned()).ok());
                }
                _ => {}
            },
            Event::Empty(event) => {
                if event.name().as_ref() == b"w:pStyle" {
                    style = event
                        .attributes()
                        .flatten()
                        .find(|attribute| attribute.key.as_ref() == b"w:val")
                        .and_then(|attribute| String::from_utf8(attribute.value.into_owned()).ok());
                }
            }
            Event::Text(event) => {
                let decoded = event.decode().map_err(|error| error.to_string())?;
                let text = quick_xml::escape::unescape(&decoded)
                    .map_err(|error| error.to_string())?
                    .into_owned();
                if let Some(cell) = current_cell.as_mut() {
                    cell.push_str(&text);
                } else if in_paragraph {
                    paragraph.push_str(&text);
                }
            }
            Event::GeneralRef(reference) => {
                let raw: &[u8] = reference.as_ref();
                let text = match raw {
                    b"amp" => "&",
                    b"lt" => "<",
                    b"gt" => ">",
                    b"quot" => "\"",
                    b"apos" => "'",
                    _ => "",
                };
                if let Some(cell) = current_cell.as_mut() {
                    cell.push_str(text);
                } else if in_paragraph {
                    paragraph.push_str(text);
                }
            }
            Event::End(event) => match event.name().as_ref() {
                b"w:p" => {
                    if !in_table && !paragraph.trim().is_empty() {
                        let prefix = match style.as_deref() {
                            Some("Heading1") => "# ",
                            Some("Heading2") => "## ",
                            Some("ListParagraph") => "1. ",
                            _ => "",
                        };
                        output.push(format!("{prefix}{}", paragraph.trim()));
                    }
                    in_paragraph = false;
                }
                b"w:tc" => {
                    if let Some(cell) = current_cell.take() {
                        current_row.push(cell.trim().to_string());
                    }
                }
                b"w:tr" => {
                    if !current_row.is_empty() {
                        table_rows.push(current_row.clone());
                    }
                }
                b"w:tbl" => {
                    if !table_rows.is_empty() {
                        output.push(
                            table_rows
                                .iter()
                                .map(|row| format!("| {} |", row.join(" | ")))
                                .collect::<Vec<_>>()
                                .join("\n"),
                        );
                    }
                    in_table = false;
                }
                _ => {}
            },
            Event::Eof => break,
            _ => {}
        }
        buffer.clear();
    }
    if output.is_empty() {
        return Err("The DOCX contains no importable paragraphs or tables.".to_string());
    }
    Ok(output.join("\n\n") + "\n")
}

fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

const CONTENT_TYPES: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#;
const ROOT_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#;
const DOCUMENT_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>"#;

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn round_trips_basic_djot_document() {
        let path = std::env::temp_dir().join(format!("office-ide-{}.docx", uuid::Uuid::new_v4()));
        let source =
            "# Report\n\nA & B\n\n## Results\n\n| Region | Sales |\n|---|---:|\n| Tokyo | 1450 |\n";
        export_docx(&path, source).unwrap();
        let restored = import_docx(&path).unwrap();
        let _ = std::fs::remove_file(path);
        assert!(restored.contains("# Report"));
        assert!(restored.contains("A & B"));
        assert!(restored.contains("| Tokyo | 1450 |"));
    }
}
