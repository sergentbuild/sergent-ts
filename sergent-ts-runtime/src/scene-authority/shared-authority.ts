/** The shared live Scene policy chosen before concurrent aliases exist. */
export type SharedScenePolicy = "strict" | "rebase";

/** One isolated application-facing read from shared Scene authority. */
export interface SharedSceneSnapshot<Scene> {
  readonly scene: Scene;
  readonly revision: number;
}

/** Public application surface of one shared live Scene owner. */
export interface SharedSceneAuthority<Scene> {
  /** Returns an isolated current Scene with its external revision. */
  read(): SharedSceneSnapshot<Scene>;

  /** Replaces current application state and advances external revision once. */
  advance(scene: Scene): SharedSceneSnapshot<Scene>;
}

/** Public generic constructor for one shared Scene authority. */
interface SharedSceneAuthorityConstructor {
  new <Scene>(
    scene: Scene,
    revision: number,
    policy: SharedScenePolicy,
    clone: (scene: Scene) => Scene,
  ): SharedSceneAuthority<Scene>;
}

/** Result of one synchronous revision-checked installation. */
export type SharedInstallResult<Scene> =
  | Readonly<{ ok: true; scene: Scene; revision: number }>
  | Readonly<{ ok: false; currentRevision: number }>;

/** Rejects an external revision that cannot advance safely. */
function assertRevision(revision: number): void {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new TypeError("Shared Scene revision must be a nonnegative safe integer");
  }
}

/** Advances one checked external revision. */
function nextRevision(revision: number): number {
  const next = revision + 1;
  if (!Number.isSafeInteger(next)) throw new RangeError("Shared Scene revision overflow");
  return next;
}

/** Private implementation retaining runtime-only commit authority. */
class SharedSceneAuthorityOwner<Scene> implements SharedSceneAuthority<Scene> {
  #scene: Scene;
  #revision: number;
  readonly #policy: SharedScenePolicy;
  readonly #clone: (scene: Scene) => Scene;

  /** Captures the initial Scene before the authority becomes shareable. */
  public constructor(
    scene: Scene,
    revision: number,
    policy: SharedScenePolicy,
    clone: (scene: Scene) => Scene,
  ) {
    assertRevision(revision);
    this.#scene = clone(scene);
    this.#revision = revision;
    this.#policy = policy;
    this.#clone = clone;
  }

  /** Returns an isolated current Scene with its external revision. */
  public read(): SharedSceneSnapshot<Scene> {
    return { scene: this.#clone(this.#scene), revision: this.#revision };
  }

  /** Replaces current application state and advances external revision once. */
  public advance(scene: Scene): SharedSceneSnapshot<Scene> {
    const owned = this.#clone(scene);
    const returned = this.#clone(owned);
    const revision = nextRevision(this.#revision);
    this.#scene = owned;
    this.#revision = revision;
    return { scene: returned, revision };
  }

  /** Returns private stale policy to the owning unit helper. */
  public runtimePolicy(): SharedScenePolicy {
    return this.#policy;
  }

  /** Installs one isolated candidate only while its external revision matches. */
  public runtimeInstall(expectedRevision: number, scene: Scene): SharedInstallResult<Scene> {
    if (this.#revision !== expectedRevision) {
      return { ok: false, currentRevision: this.#revision };
    }
    const owned = this.#clone(scene);
    const returned = this.#clone(owned);
    if (this.#revision !== expectedRevision) {
      return { ok: false, currentRevision: this.#revision };
    }
    const revision = nextRevision(this.#revision);
    this.#scene = owned;
    this.#revision = revision;
    return { ok: true, scene: returned, revision };
  }
}

/** Public constructor value hiding runtime-only owner methods. */
export const SharedSceneAuthority: SharedSceneAuthorityConstructor = SharedSceneAuthorityOwner;

/** Narrows a public authority to this unit's construction-owned implementation. */
function isAuthorityOwner<Scene>(
  value: SharedSceneAuthority<Scene>,
): value is SharedSceneAuthorityOwner<Scene> {
  return value instanceof SharedSceneAuthorityOwner;
}

/** Returns true only for an authority constructed by this module. */
export function isSharedSceneAuthority<Scene>(
  value: Scene | SharedSceneAuthority<Scene>,
): value is SharedSceneAuthority<Scene> {
  return value instanceof SharedSceneAuthorityOwner;
}

/** Returns this unit's construction-owned authority implementation. */
function authorityOwner<Scene>(
  authority: SharedSceneAuthority<Scene>,
): SharedSceneAuthorityOwner<Scene> {
  if (!isAuthorityOwner(authority)) throw new TypeError("Unknown shared Scene authority");
  return authority;
}

/** Returns the configured stale policy without exposing mutable state. */
export function sharedScenePolicy<Scene>(
  authority: SharedSceneAuthority<Scene>,
): SharedScenePolicy {
  return authorityOwner(authority).runtimePolicy();
}

/** Installs one candidate only if external revision still matches. */
export function installSharedScene<Scene>(
  authority: SharedSceneAuthority<Scene>,
  expectedRevision: number,
  scene: Scene,
): SharedInstallResult<Scene> {
  return authorityOwner(authority).runtimeInstall(expectedRevision, scene);
}
