//! ByteCaptions patch: pure-Rust linear algebra (nalgebra) in place of ndarray-linalg, whose
//! default x86-64 backend statically links the proprietary Intel MKL.

use nalgebra::DMatrix;
use ndarray::{Array1, Array2};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinalgError {
    /// The matrix has no inverse.
    Singular,
    /// The second matrix of a generalized eigenproblem isn't positive definite.
    NotPositiveDefinite,
}

impl std::fmt::Display for LinalgError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Singular => write!(f, "matrix is singular"),
            Self::NotPositiveDefinite => write!(f, "matrix is not positive definite"),
        }
    }
}

impl std::error::Error for LinalgError {}

fn to_na(a: &Array2<f64>) -> DMatrix<f64> {
    DMatrix::from_fn(a.nrows(), a.ncols(), |i, j| a[[i, j]])
}

fn from_na(m: &DMatrix<f64>) -> Array2<f64> {
    Array2::from_shape_fn((m.nrows(), m.ncols()), |(i, j)| m[(i, j)])
}

/// Inverse of a square matrix.
pub fn inverse(a: &Array2<f64>) -> Result<Array2<f64>, LinalgError> {
    to_na(a).try_inverse().map(|m| from_na(&m)).ok_or(LinalgError::Singular)
}

/// Solves the symmetric-definite generalized eigenproblem `A v = λ B v` (B positive definite),
/// like LAPACK's `sygv`: eigenvalues ascending, eigenvectors as columns normalised so
/// `vᵀ B v = 1`.
pub fn eigh_generalized(
    a: &Array2<f64>,
    b: &Array2<f64>,
) -> Result<(Array1<f64>, Array2<f64>), LinalgError> {
    let a = to_na(a);
    let b = to_na(b);
    // Symmetrise from the lower triangles, as UPLO::Lower did.
    let a = DMatrix::from_fn(a.nrows(), a.ncols(), |i, j| if i >= j { a[(i, j)] } else { a[(j, i)] });
    let b = DMatrix::from_fn(b.nrows(), b.ncols(), |i, j| if i >= j { b[(i, j)] } else { b[(j, i)] });
    let l = b.cholesky().ok_or(LinalgError::NotPositiveDefinite)?.unpack();
    let l_inv = l.clone().try_inverse().ok_or(LinalgError::Singular)?;
    let c = &l_inv * &a * l_inv.transpose();
    let c = (&c + c.transpose()) * 0.5;
    let eig = c.symmetric_eigen();
    let vectors = l_inv.transpose() * eig.eigenvectors;
    let mut order: Vec<usize> = (0..eig.eigenvalues.len()).collect();
    order.sort_by(|&i, &j| eig.eigenvalues[i].total_cmp(&eig.eigenvalues[j]));
    let values = Array1::from_iter(order.iter().map(|&i| eig.eigenvalues[i]));
    let vectors = Array2::from_shape_fn((vectors.nrows(), order.len()), |(r, c)| vectors[(r, order[c])]);
    Ok((values, vectors))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ndarray::array;

    #[test]
    fn generalized_eigen_solves_av_equals_lambda_bv() {
        let a = array![[4.0, 1.0, 0.5], [1.0, 3.0, 0.2], [0.5, 0.2, 2.0]];
        let b = array![[2.0, 0.3, 0.0], [0.3, 1.5, 0.1], [0.0, 0.1, 1.0]];
        let (values, vectors) = eigh_generalized(&a, &b).unwrap();
        assert!(values[0] <= values[1] && values[1] <= values[2]);
        for k in 0..3 {
            let v = vectors.column(k);
            let av = a.dot(&v);
            let bv = b.dot(&v);
            for i in 0..3 {
                assert!((av[i] - values[k] * bv[i]).abs() < 1e-10);
            }
            assert!((v.dot(&bv) - 1.0).abs() < 1e-10);
        }
    }

    #[test]
    fn inverse_round_trips() {
        let a = array![[4.0, 1.0], [2.0, 3.0]];
        let product = a.dot(&inverse(&a).unwrap());
        assert!((product[[0, 0]] - 1.0).abs() < 1e-12 && product[[0, 1]].abs() < 1e-12);
    }
}
