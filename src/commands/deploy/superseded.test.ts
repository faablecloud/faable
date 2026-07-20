import test from "ava"
import { is_superseded } from "./superseded"

const at = (iso: string) => ({ id: `deployment_${iso}`, createdAt: iso })

test("a newer promoted deployment supersedes ours", (t) => {
  t.true(
    is_superseded(
      { id: "d1", createdAt: "2026-07-20T16:20:59.484Z" },
      { id: "d2", createdAt: "2026-07-20T16:20:59.563Z" }
    )
  )
})

test("same-instant twins supersede each other (>=)", (t) => {
  t.true(
    is_superseded(
      { id: "d1", createdAt: "2026-07-20T16:20:59.000Z" },
      { id: "d2", createdAt: "2026-07-20T16:20:59.000Z" }
    )
  )
})

test("the PREVIOUS (older) active never supersedes — keep waiting", (t) => {
  t.false(
    is_superseded(
      { id: "d2", createdAt: "2026-07-20T16:20:59.563Z" },
      { id: "d0", createdAt: "2026-07-19T10:00:00.000Z" }
    )
  )
})

test("our own deployment or a missing active never supersede", (t) => {
  const mine = at("2026-07-20T16:20:59.484Z")
  t.false(is_superseded(mine, mine))
  t.false(is_superseded(mine, null))
  t.false(is_superseded(mine, undefined))
})
