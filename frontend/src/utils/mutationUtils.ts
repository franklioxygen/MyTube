interface MutationCallbacks {
    onSuccess?: () => void;
    onError?: (error: unknown) => void;
}

interface AsyncCapableMutation<TVariables> {
    mutate: (variables: TVariables, callbacks?: MutationCallbacks) => void;
    mutateAsync?: (variables: TVariables) => Promise<unknown>;
}

export function runMutationAsync<TVariables>(
    mutation: AsyncCapableMutation<TVariables>,
    variables: TVariables
): Promise<unknown> {
    if (typeof mutation.mutateAsync === 'function') {
        return mutation.mutateAsync(variables);
    }

    return new Promise((resolve, reject) => {
        mutation.mutate(variables, {
            onSuccess: () => resolve(undefined),
            onError: reject,
        });
    });
}
