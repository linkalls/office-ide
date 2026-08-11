use serde::{Deserialize, Serialize};
use std::{
    env,
    io::{BufRead, BufReader, Write},
    net::TcpStream,
    process::ExitCode,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SheetctlRequest<'a> {
    token: &'a str,
    command: String,
}

#[derive(Deserialize)]
struct SheetctlResponse {
    ok: bool,
    message: Option<String>,
}

fn usage() -> &'static str {
    "Usage: sheetctl context\n       sheetctl range A1:C10\n       sheetctl cell set B2 100\n       sheetctl formula set G2 =ROUND(C2/D2,0)\n       sheetctl formula column G \"Average unit price\" =ROUND(C2/D2,0)\n\nEndpoint and token are read from SHEETCTL_ENDPOINT and SHEETCTL_TOKEN, or can be supplied with --endpoint and --token."
}

fn main() -> ExitCode {
    let mut args = env::args().skip(1);
    let mut endpoint = None;
    let mut token = None;
    let mut command = Vec::new();
    while let Some(argument) = args.next() {
        match argument.as_str() {
            "--endpoint" => endpoint = args.next(),
            "--token" => token = args.next(),
            "--help" | "-h" => {
                println!("{}", usage());
                return ExitCode::SUCCESS;
            }
            _ => command.push(argument),
        }
    }
    let endpoint = endpoint.or_else(|| env::var("SHEETCTL_ENDPOINT").ok());
    let token = token.or_else(|| env::var("SHEETCTL_TOKEN").ok());
    let (Some(endpoint), Some(token)) = (endpoint, token) else {
        eprintln!("{}", usage());
        return ExitCode::from(2);
    };
    let valid_command = matches!(command.as_slice(), [context] if context == "context")
        || matches!(command.as_slice(), [range, address] if range == "range" && !address.is_empty())
        || matches!(command.as_slice(), [subject, action, address, value @ ..]
            if matches!(subject.as_str(), "cell" | "formula")
              && action == "set"
              && !address.is_empty()
              && !value.is_empty())
        || matches!(command.as_slice(), [subject, action, column, header, formula @ ..]
            if subject == "formula"
              && action == "column"
              && !column.is_empty()
              && !header.is_empty()
              && !formula.is_empty());
    if !valid_command {
        eprintln!("{}", usage());
        return ExitCode::from(2);
    }

    let request = SheetctlRequest {
        token: &token,
        command: format!("sheetctl {}", command.join(" ")),
    };
    let payload = match serde_json::to_string(&request) {
        Ok(payload) => payload,
        Err(error) => {
            eprintln!("Could not serialize request: {error}");
            return ExitCode::FAILURE;
        }
    };
    let mut stream = match TcpStream::connect(&endpoint) {
        Ok(stream) => stream,
        Err(error) => {
            eprintln!("Could not reach Office IDE at {endpoint}: {error}");
            return ExitCode::FAILURE;
        }
    };
    if stream.write_all(format!("{payload}\n").as_bytes()).is_err() {
        eprintln!("Could not send sheetctl request");
        return ExitCode::FAILURE;
    }
    let mut response = String::new();
    if BufReader::new(&stream).read_line(&mut response).is_err() {
        eprintln!("Office IDE closed the sheetctl connection");
        return ExitCode::FAILURE;
    }
    match serde_json::from_str::<SheetctlResponse>(&response) {
        Ok(response) if response.ok => {
            println!(
                "{}",
                response.message.unwrap_or_else(|| "Applied".to_owned())
            );
            ExitCode::SUCCESS
        }
        Ok(response) => {
            eprintln!(
                "{}",
                response.message.unwrap_or_else(|| "Rejected".to_owned())
            );
            ExitCode::FAILURE
        }
        Err(error) => {
            eprintln!("Invalid response from Office IDE: {error}");
            ExitCode::FAILURE
        }
    }
}
