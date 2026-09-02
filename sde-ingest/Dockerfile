FROM rust:1.89-bookworm AS build

WORKDIR /workspace
COPY sde-ingest ./sde-ingest
RUN cargo build --locked --release --manifest-path sde-ingest/Cargo.toml

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /workspace/sde-ingest/target/release/sde-ingest /usr/local/bin/sde-ingest

USER 65534:65534

ENTRYPOINT ["sde-ingest"]
