# Testing rules

Which categories run is set by the track's `testing.*` gates. How they are
written is set here.

## What a test is for **[always]**

A test exists to catch a regression a human would otherwise ship. If a test
cannot fail in a way that matters, it is decoration — delete it.

## Writing tests

- Test **behaviour through the public surface**, not internals. Tests coupled to
  implementation break on every refactor and protect nothing.
- One reason to fail per test. A test asserting six things reports one bug badly.
- The name states the scenario and expectation:
  `rejects_expired_token`, not `test_auth_2`.
- Arrange / Act / Assert, visibly separated.
- Deterministic. No real clocks, no real network, no shared mutable state, no
  ordering dependence between tests.

## Coverage

`coverage_target: meaningful` means cover *behaviours and edges*, not a
percentage. Chasing a number produces tests that assert nothing. What must be
covered: the documented contract, each error path, each boundary condition, and
every bug ever found here.

## Mocking

- Mock what you do not own: third-party APIs, clocks, randomness, the network.
- Do **not** mock what you own — mocking your own module tests the mock.
- Never mock the thing under test. If that seems necessary, the design is wrong.

## Fixing a failing test **[always]**

Diagnose which side is wrong before touching anything. Then fix *that* side.

Forbidden, on every track: weakening an assertion, adding a skip, widening a
tolerance, or catching the exception — in order to get to green without
understanding the failure. If a test is genuinely obsolete, delete it
deliberately and say why.

## Regression discipline

Every bug fixed gets a test that **fails without the fix**. Verify that it fails
by running it against the unfixed code — an unverified regression test is a
comment with extra steps.
