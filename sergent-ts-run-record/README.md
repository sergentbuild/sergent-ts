# sergent-ts-run-record

This component turns the evidence of a Sergent Run into one portable JSON Lines file on a Node
filesystem. It watches a Run from the outside and never changes what the Run does.

## The Run Record and how it reaches a file

A Run Record is the complete, inert evidence of one finished Run. The
[Run Record specification](../sergent/docs/run-record-spec.md#the-run-record), in "The Run
Record", defines its structure.

The record does not start here. While a Run advances, the builders in `sergent-ts-observability`
accumulate it in memory. One closing call, on success, failure, or cancellation, finishes the
record, and the runtime hands it to every configured observer inside a `SergentResult`.

`createRunRecordHarness` returns a `RunRecordHarness`, and that harness is an ordinary observer.
Hand it to the runtime together with your other observers, and it writes two framework lines for
a Run: a Run start line when the Run reaches its started stage, and a Run end line carrying the
complete record when the Run finishes.

At any point while the file is open, the application can add context of its own through
`applicationEvent` and `userEvent`. Each of the two takes an optional `EventCorrelation` that ties
the line to a Run, a Scene, and a revision. The harness publishes the path it composed as
`file_path`, so an application can tell a person where the evidence landed. A final `close`
synchronizes the file and closes it once.

The file exists from the moment you construct the harness, which creates it exclusively and
refuses an existing path. The
[Run Record file format](../sergent/docs/run-record-file-format.md#file-discipline), in "File
discipline", fixes the filename and the rules for a healthy file, and its other sections fix the
line envelope and the encoding. This component implements that document and adds nothing to it.

A persisted Run end carries the complete record, which is sensitive forensic material. The
"Sensitivity" section of the same
[file format](../sergent/docs/run-record-file-format.md#sensitivity) lists what such a line can
hold, and the application decides where these files live and how long they stay.

## Working with the observability component

`sergent-ts-observability` builds the evidence and defines the observer interface. This component
only persists what that evidence already is.

The split follows platforms. Observability fits a browser page or a worker; writing a file needs
Node, so everything Node-only lives here and the runtime never depends on this component.

Start with the [observability component](../sergent-ts-observability/README.md) when a value
inside a Run Record file puzzles you. The [component knowledge](docs/KNOWLEDGE.md) carries the
technical design: the write path, the failure paths, and where each responsibility sits.
