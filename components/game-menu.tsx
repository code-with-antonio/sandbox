"use client"

import { EllipsisIcon, PencilLineIcon, Trash2Icon } from "lucide-react"
import { usePathname } from "next/navigation"
import { useState, useTransition } from "react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { deleteGame, renameGame } from "@/lib/games/actions"
import { TITLE_MAX_LENGTH } from "@/lib/games/title"

/**
 * What can be done to a game: rename it, or throw it away.
 *
 * Both go through a dialog rather than straight to the action. Renaming needs
 * one because it has something to collect; deleting needs one because it takes
 * the thread and the sandbox with it and there is no undo — hence an
 * `AlertDialog` for that one and a plain `Dialog` for the other.
 *
 * The title is a prop rather than state: every caller renders it from the row
 * and re-renders after a rename, so what is on screen is the server's answer
 * and this only holds what is being typed into the box.
 *
 * `trigger` is what opens the menu. The default suits a toolbar; the sidebar
 * passes a `SidebarMenuAction` instead, so the same menu can sit on a row that
 * reveals it on hover.
 */
export function GameMenu({
  gameId,
  title,
  trigger,
}: {
  gameId: string
  title: string
  trigger?: React.ReactElement
}) {
  const pathname = usePathname()
  const [dialog, setDialog] = useState<"rename" | "delete" | null>(null)
  const [name, setName] = useState(title)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // The box starts from what the game is called now, every time — a name
  // abandoned in a previous open should not come back on the next one.
  function openDialog(next: "rename" | "delete") {
    setName(title)
    setError(null)
    setDialog(next)
  }

  // A running action owns the dialog: dismissing it mid-flight would leave the
  // player with no sign of what happened, and in the delete's case with a page
  // that is about to navigate out from under them anyway.
  function handleOpenChange(open: boolean) {
    if (!open && !isPending) {
      setDialog(null)
    }
  }

  function handleRename(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    startTransition(async () => {
      try {
        await renameGame(gameId, name)
        setDialog(null)
      } catch {
        // Server Action errors reach the browser stripped of their message in
        // production, so there is nothing here worth showing verbatim — only
        // that the name was not saved, and that trying again is reasonable.
        setError("That name could not be saved. Try again.")
      }
    })
  }

  function handleDelete() {
    setError(null)

    startTransition(async () => {
      try {
        // Whether the delete has to navigate is a question only the browser can
        // answer, and this is where the answer is: the menu is on the game's own
        // header and on every row of the sidebar, so the same click means "leave
        // this page" in one place and "the list is one shorter" in the other.
        //
        // Nothing closes the dialog on success. Either the page is being left,
        // or the row this menu belongs to is about to stop being rendered.
        await deleteGame(gameId, pathname === `/games/${gameId}`)
      } catch {
        setError("This game could not be deleted. Try again.")
      }
    })
  }

  const trimmed = name.trim()

  return (
    <>
      <DropdownMenu>
        {/* Named after the game rather than labelled "Game options", because
            the sidebar puts one of these on every row and a screen reader
            would otherwise read out a column of identical buttons. */}
        <DropdownMenuTrigger
          aria-label={`Options for ${title}`}
          render={trigger ?? <Button variant="ghost" size="icon-sm" />}
        >
          <EllipsisIcon />
        </DropdownMenuTrigger>
        {/* Anchored to the trigger's right edge, which is the window's — a menu
            aligned the other way would hang off the screen. */}
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onClick={() => openDialog("rename")}>
            <PencilLineIcon />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={() => openDialog("delete")}
          >
            <Trash2Icon />
            Move to trash
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Controlled and rendered outside the menu, which is how a dialog is
          opened from one: the menu closes on click, taking anything inside it
          with it. */}
      <Dialog open={dialog === "rename"} onOpenChange={handleOpenChange}>
        <DialogContent>
          <form onSubmit={handleRename} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Rename game</DialogTitle>
              <DialogDescription>
                This is the name in the sidebar and above the thread. It does
                not change the game itself.
              </DialogDescription>
            </DialogHeader>
            <Field>
              <FieldLabel htmlFor="game-title">Name</FieldLabel>
              <Input
                id="game-title"
                name="title"
                value={name}
                onChange={(event) => setName(event.target.value)}
                // The same cap the server applies, so a long name is stopped
                // while it is being typed rather than silently shortened after.
                maxLength={TITLE_MAX_LENGTH}
                disabled={isPending}
                autoFocus
              />
            </Field>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>
                Cancel
              </DialogClose>
              {/* `type` because Base UI buttons default to `button`, and
                  `focusableWhenDisabled` so the press that disables this one
                  does not drop focus out of the dialog. */}
              <Button
                type="submit"
                disabled={!trimmed || isPending}
                focusableWhenDisabled
              >
                {isPending && <Spinner />}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={dialog === "delete"} onOpenChange={handleOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <Trash2Icon className="text-destructive" />
            </AlertDialogMedia>
            <AlertDialogTitle>Move “{title}” to trash?</AlertDialogTitle>
            <AlertDialogDescription>
              The thread and the sandbox it was built in go with it. This cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleDelete}
              disabled={isPending}
              focusableWhenDisabled
            >
              {isPending && <Spinner />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
