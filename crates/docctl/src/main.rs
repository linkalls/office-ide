use serde::{Deserialize, Serialize};
use std::{
    env,
    io::{BufRead, BufReader, Write},
    net::TcpStream,
    process::ExitCode,
};

#[derive(Serialize)]
struct Request<'a> {
    token: &'a str,
    command: String,
}
#[derive(Deserialize)]
struct Response {
    ok: bool,
    message: Option<String>,
}

fn usage() -> &'static str {
    "Usage: docctl context\n       docctl selection read\n       docctl selection replace <text>\n       docctl append <text>\n\nEndpoint and token are read from DOCCTL_ENDPOINT and DOCCTL_TOKEN, or can be supplied with --endpoint and --token."
}

fn valid(command: &[String]) -> bool {
    matches!(command, [context] if context == "context")
        || matches!(command, [selection, read] if selection == "selection" && read == "read")
        || matches!(command, [selection, replace, text @ ..] if selection == "selection" && replace == "replace" && !text.is_empty())
        || matches!(command, [append, text @ ..] if append == "append" && !text.is_empty())
}

fn main() -> ExitCode {
    let mut args = env::args().skip(1);
    let (mut endpoint, mut token, mut command) = (None, None, Vec::new());
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
    let endpoint = endpoint.or_else(|| env::var("DOCCTL_ENDPOINT").ok());
    let token = token.or_else(|| env::var("DOCCTL_TOKEN").ok());
    let (Some(endpoint), Some(token)) = (endpoint, token) else {
        eprintln!("{}", usage());
        return ExitCode::from(2);
    };
    if !valid(&command) {
        eprintln!("{}", usage());
        return ExitCode::from(2);
    }
    let payload = match serde_json::to_string(&Request {
        token: &token,
        command: format!("docctl {}", command.join(" ")),
    }) {
        Ok(value) => value,
        Err(error) => {
            eprintln!("Could not serialize request: {error}");
            return ExitCode::FAILURE;
        }
    };
    let mut stream = match TcpStream::connect(&endpoint) {
        Ok(value) => value,
        Err(error) => {
            eprintln!("Could not reach Office IDE at {endpoint}: {error}");
            return ExitCode::FAILURE;
        }
    };
    if stream.write_all(format!("{payload}\n").as_bytes()).is_err() {
        eprintln!("Could not send docctl request");
        return ExitCode::FAILURE;
    }
    let mut line = String::new();
    if BufReader::new(&stream).read_line(&mut line).is_err() {
        eprintln!("Office IDE closed the docctl connection");
        return ExitCode::FAILURE;
    }
    match serde_json::from_str::<Response>(&line) {
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

#[cfg(test)]
mod tests {
    use super::valid;

    #[test]
    fn accepts_only_the_reviewable_document_commands() {
        assert!(valid(&["context".to_owned()]));
        assert!(valid(&["selection".to_owned(), "read".to_owned()]));
        assert!(valid(&["append".to_owned(), "Review".to_owned()]));
        assert!(valid(&[
            "selection".to_owned(),
            "replace".to_owned(),
            "Review".to_owned()
        ]));
        assert!(!valid(&["export".to_owned(), "report.docx".to_owned()]));
    }
}
