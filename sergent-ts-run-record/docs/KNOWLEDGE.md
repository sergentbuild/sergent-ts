# sergent-ts-run-record knowledge

This component is the filesystem boundary of the Sergent TypeScript implementation. It persists
evidence that another component already built, and it invents no rule of its own.

## The life of one Run Record

A Run Record lives in three places: in memory while the Run advances, in the observer callbacks
at the end of the Run, and in a file. Only the third place belongs here, and keeping the first
two elsewhere is what makes the design work.

### While the Run advances

The record is assembled in `sergent-ts-observability`. Its builders open a record for a Run, bind
the Scene identity, and append one Step Record per step while the runtime drives the Run forward.
A record accepts exactly one closing call, which seals it; a later change raises. Nothing
reaches a file during this phase, and nothing in this phase can influence the Run. The
[observability component](../../sergent-ts-observability/README.md) explains that assembly.

### When the Run ends

Delivery is the runtime's job. Every configured observer slot receives the same callbacks, and the
[observability specification](../../sergent/docs/observability.md#observer-delivery), in "Observer
delivery", fixes their sequence and the containment rule. This component simply sits in one of
those slots: `RunRecordHarness` extends `RunObserver`, so it answers the same two callbacks as any
other observer.

On `progress`, the harness ignores every snapshot except the first one per Run ID whose stage is
`started` and whose status is `running`. It writes the Run start line first and remembers the Run
ID only after that write is acknowledged, so a failed write leaves nothing remembered. The "Run
start" section of the
[Run Record file format](../../sergent/docs/run-record-file-format.md#run-start) states that
deduplication rule.

On `finished`, the harness writes one Run end line for each terminal callback it receives,
carrying the complete record with no projection and no filter. The envelope revision comes from
the record's Scene transition, as the "Run end" section of the
[file format](../../sergent/docs/run-record-file-format.md#run-end) prescribes. That section also
describes a record with no Scene transition. Here a record cannot be closed without one, because
the builders refuse to close it, so the harness never meets that case and carries no guard for it.

### Direct application and user events

`applicationEvent` and `userEvent` come from the application, never from the runtime. They do not
wait for a Run. An application can record one before the first Run, while a Run is in flight, or
with no Run at all; only a closed or disabled file refuses them.

Each call checks the event name and the shape of the correlation values, then projects the payload
and writes one line through the same path a framework line takes. The name is stored exactly as
given, and nothing trims it. An application event can never be mistaken for framework evidence,
because the activity channel decides that, not the event name, as the "Line envelope" section of
the [file format](../../sergent/docs/run-record-file-format.md#line-envelope) states.

### On the file

Construction is not lazy. Creating a harness validates the application name and the log identity,
composes the filename, and exclusively creates the file at once. It supplies a log identity when
the application gives none, and it stamps the filename with the same clock and the same timestamp
format the lines use, so one file never mixes two clocks. The grammar of all three filename
components belongs to the "File discipline" section of the
[Run Record file format](../../sergent/docs/run-record-file-format.md#file-discipline). A harness
that exists has a file, and a failed construction leaves nothing behind.

Every line then travels the same short path: project the payload when it came from the
application, assemble the envelope, encode one canonical line in memory, write every byte,
synchronize, and only then acknowledge. Doing all of that work before any I/O is what keeps a
value with no faithful JSON form, such as a cycle or a non-finite number, from ever touching the
file.

This implementation synchronizes every acknowledged line, while the "File discipline" section of
the [file format](../../sergent/docs/run-record-file-format.md#file-discipline) asks for that only
ahead of a Run end. Paying it on every line costs a little throughput and buys two things: an
acknowledged line survives a host crash, and a storage failure surfaces while the harness can
still report it rather than silently later.

The writer holds three states: healthy, permanently disabled by its first persistence failure, and
closed. A disabled writer refuses later work and chains the original failure as the cause, so the
first failure stays the explanation. Closing a healthy file synchronizes it once and is
idempotent.

### Each failure has one delivery path

A direct call raises to the application, because the application is the caller and can react to
it. A failure on an observer callback is contained by the runtime instead, and arrives as an
`observer_error` beside the record in the `SergentResult`. Neither path reports the other path's
failure a second time.

The harness asks the writer whether it is still available before it projects a payload, so a file
that is already disabled never pays for a conversion it cannot use.

## Separation of responsibility

Two components, one flow. The boundary between them follows the platforms they must run on, not a
taste for layering.

### Why the boundary sits here

`sergent-ts-observability` and `sergent-ts-runtime` use standard Web APIs only, so they type-check
for a browser main thread and for workers. Writing a file needs Node. Keeping the filesystem in a
separate package holds the Node-only modules out of every browser dependency graph, and the
runtime's manifest does not list this package at all. Persistence becomes an application decision
rather than a framework feature.

The [observability specification](../../sergent/docs/observability.md#the-portable-run-record-file-format),
in "The portable Run Record file format", states that persistence is optional and stands at a
separate boundary. This implementation draws that boundary as a package boundary.

### What observability is in charge of

Everything about the evidence itself: the record shapes, the builders that fill them, the observer
interface, the progress snapshots, the system clock, the timestamp format, and the native type
names that appear in captured and converted values. This component imports the clock, the
timestamp format, and the type naming instead of reimplementing any of them, so every timestamp in
a file is written one way, on the line and inside the record that line carries.

From `sergent-ts-core` this component takes types only: the Run ID type and the JSON value types.
No value crosses that edge on the write path.

### What this component is in charge of

The source is one flat unit that divides into four responsibilities.

- The harness is the application-facing surface. It validates the filename components, composes
  the filename, answers the observer callbacks, accepts direct events, and assembles every line
  envelope.
- Value conversion projects application values into the portable JSON vocabulary that the
  "Application and user events" section of the
  [file format](../../sergent/docs/run-record-file-format.md#application-and-user-events) names.
  It is outbound projection, not a second admission boundary. It refuses only what it cannot
  record honestly, a cycle or a non-finite number, and describes a value with no JSON shape
  instead of inventing a structure for it.
- The canonical line encoder produces one deterministic ASCII line in memory. It configures the
  exact-pinned `safe-stable-stringify` dependency rather than hand-writing canonical JSON, and it
  supplies a key comparator of its own, because the "Exact line encoding" section of the
  [file format](../../sergent/docs/run-record-file-format.md#exact-line-encoding) asks for
  ascending Unicode code point order of the unescaped key, which differs from the default UTF-16
  order above the basic plane.
- The file writer holds the descriptor and every failure that touches it.

Three symbols leave the package: `createRunRecordHarness`, `RunRecordHarness`, and
`EventCorrelation`. The encoder, the conversion, and the file adapter stay inside, so nothing
outside can assemble a second persistence path from the parts.

This component writes and never reads. Evidence flows one way, which is why no reader exists here.

### What the application decides

The application chooses whether to persist at all, and it hands the harness the directory and the
log identity at construction, then decides when the file closes. The
[observability specification](../../sergent/docs/observability.md#ownership), in "Ownership",
sets the rest of the application's policy, including retention and redaction.

One harness creates its file exclusively, so a second harness cannot open the same path. Inside
one JavaScript thread every write runs to completion before anything else does, so concurrent Runs
sharing a harness cannot interleave their lines, and no lock is needed here. The "Application
freedoms and limits" section of the
[file format](../../sergent/docs/run-record-file-format.md#application-freedoms-and-limits) draws
the rest of the line between what an application may do and what it must leave to the harness.

### Proving the write path without a filesystem

Beside the public constructor the package keeps an internal one,
`createRunRecordHarnessWithDependencies`, which injects the clock, the file adapter, and the
source of the default log identity. It stays internal: the package entry point does not export it.
Tests use it to assert exact bytes, write counts, and synchronization counts with no filesystem at
all. Only the refusal of an existing path uses a real temporary directory, because only a real
filesystem can show exclusive creation doing its work.
